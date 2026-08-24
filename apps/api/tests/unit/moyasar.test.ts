/**
 * The Moyasar provider.
 *
 * Unit tests against a stubbed `fetch`, because the parts of a payment
 * integration that go wrong are the parts nobody can see from the outside:
 * whether the amount was scaled, which of two ids settlement is keyed on, and
 * whether a status that means "held, not taken" is treated as money received.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';
import { MoyasarPaymentProvider } from '../../src/services/payment/moyasar.js';

const SECRET = 'sk_test_unit_key';
const WEBHOOK_TOKEN = 'a_real_looking_webhook_token_42';

let provider: MoyasarPaymentProvider;
let fetchMock: ReturnType<typeof vi.fn>;

/** Only what the provider reads. */
function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_8f2c',
    status: 'initiated',
    url: 'https://api.moyasar.com/v1/invoices/inv_8f2c',
    amount: 34_500,
    currency: 'SAR',
    ...overrides,
  };
}

/** A delivery in the shape Moyasar actually posts. */
function delivery(data: Record<string, unknown>, envelope: Record<string, unknown> = {}) {
  return {
    id: 'evt_1a2b',
    type: 'payment_paid',
    created_at: '2026-08-07T10:00:00Z',
    secret_token: WEBHOOK_TOKEN,
    account_name: 'Test',
    live: false,
    data,
    ...envelope,
  };
}

beforeEach(() => {
  process.env.PAYMENT_PROVIDER = 'moyasar';
  process.env.MOYASAR_SECRET_KEY = SECRET;
  process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_TOKEN;
  resetEnvCache();

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  provider = new MoyasarPaymentProvider();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.MOYASAR_SECRET_KEY;
  process.env.PAYMENT_WEBHOOK_SECRET = 'dev_webhook_secret';
  resetEnvCache();
});

describe('createPayment', () => {
  it('sends halalas through unscaled', async () => {
    fetchMock.mockResolvedValue(ok(invoice()));

    await provider.createPayment({
      orderId: 'ord_1',
      orderNumber: 'DW-1042',
      amountHalalas: 34_500,
      currency: 'SAR',
      method: 'MADA',
      returnUrl: 'https://example.test/ar/checkout/ord_1?verify=1',
      customer: { name: 'أم عبدالعزيز', phone: '+966500000000' },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.moyasar.com/v1/invoices');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    // 345.00 SAR. A ×100 here would charge every customer a hundred times over,
    // and a ÷100 would charge them a hundredth — both silent.
    expect(body.amount).toBe(34_500);
    expect(body.currency).toBe('SAR');
    expect(body.success_url).toBe('https://example.test/ar/checkout/ord_1?verify=1');
    expect(body.expired_at).toEqual(expect.any(String));
  });

  it('authenticates with the secret key as the Basic username and no password', async () => {
    fetchMock.mockResolvedValue(ok(invoice()));

    await provider.createPayment({
      orderId: 'ord_1',
      orderNumber: 'DW-1042',
      amountHalalas: 100,
      currency: 'SAR',
      method: 'MADA',
      returnUrl: 'https://example.test/ar/checkout/ord_1',
      customer: { name: 'ضيف', phone: '+966500000000' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const header = (init.headers as Record<string, string>).authorization ?? '';
    expect(Buffer.from(header.replace('Basic ', ''), 'base64').toString()).toBe(`${SECRET}:`);
  });

  it('carries the order id as string metadata', async () => {
    fetchMock.mockResolvedValue(ok(invoice()));

    await provider.createPayment({
      orderId: 'ord_9',
      orderNumber: 'DW-1099',
      amountHalalas: 100,
      currency: 'SAR',
      method: 'APPLE_PAY',
      returnUrl: 'https://example.test/ar/checkout/ord_9',
      customer: { name: 'ضيف', phone: '+966500000000' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { metadata: Record<string, unknown> };
    // Moyasar takes string→string only.
    for (const value of Object.values(body.metadata)) expect(typeof value).toBe('string');
    expect(body.metadata.order_id).toBe('ord_9');
  });

  it('returns the hosted page and the invoice id', async () => {
    fetchMock.mockResolvedValue(ok(invoice()));

    const result = await provider.createPayment({
      orderId: 'ord_1',
      orderNumber: 'DW-1042',
      amountHalalas: 100,
      currency: 'SAR',
      method: 'MADA',
      returnUrl: 'https://example.test/ar/checkout/ord_1',
      customer: { name: 'ضيف', phone: '+966500000000' },
    });

    expect(result.providerPaymentId).toBe('inv_8f2c');
    expect(result.redirectUrl).toBe('https://api.moyasar.com/v1/invoices/inv_8f2c');
    expect(result.status).toBe('PENDING');
  });

  it('turns a gateway refusal into a 502, not a crash', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"unauthorized"}',
    } as unknown as Response);

    await expect(
      provider.createPayment({
        orderId: 'ord_1',
        orderNumber: 'DW-1042',
        amountHalalas: 100,
        currency: 'SAR',
        method: 'MADA',
        returnUrl: 'https://example.test/ar/checkout/ord_1',
        customer: { name: 'ضيف', phone: '+966500000000' },
      }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'PAYMENT_GATEWAY_ERROR' });
  });
});

describe('verifySignature', () => {
  const sign = (body: unknown) => Buffer.from(JSON.stringify(body));

  it('accepts the configured secret token from the body', () => {
    expect(provider.verifySignature(sign(delivery({ id: 'pay_1' })), undefined)).toBe(true);
  });

  it('rejects a wrong token, a missing token and a non-JSON body', () => {
    expect(provider.verifySignature(sign(delivery({}, { secret_token: 'nope' })), undefined)).toBe(
      false,
    );
    expect(provider.verifySignature(sign({ id: 'evt_1', data: {} }), undefined)).toBe(false);
    expect(provider.verifySignature(Buffer.from('not json'), undefined)).toBe(false);
  });

  it('rejects everything while the secret is still the placeholder', () => {
    /*
     * The placeholder is published in this repo, so accepting it would mean any
     * stranger could POST `{"secret_token":"dev_webhook_secret",...}` at a
     * necessarily-public endpoint and mark orders paid.
     *
     * There are two layers. `env.ts` refuses to boot on
     * PAYMENT_PROVIDER=moyasar with the placeholder — which is why this test
     * has to set the provider back to `stub` to get past validation at all.
     * This asserts the second layer: even reached directly, the provider still
     * says no.
     */
    process.env.PAYMENT_PROVIDER = 'stub';
    process.env.PAYMENT_WEBHOOK_SECRET = 'dev_webhook_secret';
    resetEnvCache();

    const body = sign(delivery({ id: 'pay_1' }, { secret_token: 'dev_webhook_secret' }));
    expect(provider.verifySignature(body, undefined)).toBe(false);
  });

  it('refuses to boot on moyasar with the placeholder secret', async () => {
    const { loadEnv } = await import('../../src/config/env.js');

    expect(() =>
      loadEnv({
        ...process.env,
        PAYMENT_PROVIDER: 'moyasar',
        MOYASAR_SECRET_KEY: SECRET,
        PAYMENT_WEBHOOK_SECRET: 'change_me_webhook',
      }),
    ).toThrow(/PAYMENT_WEBHOOK_SECRET/);

    // And without a key at all, rather than falling back to something.
    expect(() =>
      loadEnv({
        ...process.env,
        PAYMENT_PROVIDER: 'moyasar',
        MOYASAR_SECRET_KEY: undefined,
        PAYMENT_WEBHOOK_SECRET: WEBHOOK_TOKEN,
      }),
    ).toThrow(/MOYASAR_SECRET_KEY/);
  });
});

describe('parseWebhook', () => {
  it('keys settlement on invoice_id, not the payment id', () => {
    // createPayment stored the invoice id. Returning data.id here would look up
    // a payment row that does not exist, and every real payment would be logged
    // as unknown while the order stayed unpaid.
    const envelope = provider.parseWebhook(
      delivery({
        id: 'pay_abc',
        invoice_id: 'inv_8f2c',
        status: 'paid',
        amount: 34_500,
        metadata: { order_id: 'ord_1' },
      }),
    );

    expect(envelope?.providerPaymentId).toBe('inv_8f2c');
    expect(envelope?.status).toBe('SUCCEEDED');
    expect(envelope?.amountHalalas).toBe(34_500);
    expect(envelope?.orderId).toBe('ord_1');
    expect(envelope?.providerEventId).toBe('evt_1a2b');
  });

  it('falls back to the payment id when there is no invoice', () => {
    const envelope = provider.parseWebhook(
      delivery({ id: 'pay_abc', status: 'refunded' }, { type: 'payment_refunded' }),
    );

    expect(envelope?.providerPaymentId).toBe('pay_abc');
    expect(envelope?.status).toBe('REFUNDED');
  });

  it.each([
    ['paid', 'SUCCEEDED'],
    ['captured', 'SUCCEEDED'],
    ['failed', 'FAILED'],
    ['voided', 'FAILED'],
    ['refunded', 'REFUNDED'],
    ['initiated', 'PENDING'],
    // Held, not taken. Settling here activates an event against money that was
    // never captured.
    ['authorized', 'PENDING'],
    // The 3DS/card-verification step, likewise not a payment.
    ['verified', 'PENDING'],
  ])('maps payment status %s to %s', (raw, expected) => {
    const envelope = provider.parseWebhook(delivery({ id: 'pay_1', invoice_id: 'inv_1', status: raw }));
    expect(envelope?.status).toBe(expected);
  });

  it('reads the status from the event type when the payment carries none', () => {
    // Moyasar ships `payment_faild`. Both spellings are handled so the day they
    // fix it is not the day failures stop being recognised.
    for (const type of ['payment_faild', 'payment_failed']) {
      const envelope = provider.parseWebhook(delivery({ id: 'pay_1', invoice_id: 'inv_1' }, { type }));
      expect(envelope?.status).toBe('FAILED');
    }
  });

  it('ignores a delivery from the wrong mode', () => {
    // A test-mode event must never settle a live order, nor the reverse. The
    // configured key here is sk_test_, so a live delivery is not ours.
    const envelope = provider.parseWebhook(
      delivery({ id: 'pay_1', invoice_id: 'inv_1', status: 'paid' }, { live: true }),
    );
    expect(envelope).toBeNull();
  });

  it('ignores a shape it does not understand', () => {
    expect(provider.parseWebhook(null)).toBeNull();
    expect(provider.parseWebhook({ id: 'evt_1' })).toBeNull();
    expect(provider.parseWebhook(delivery({ id: 'pay_1', status: 'something_new' }, { type: 'x' }))).toBeNull();
  });
});

describe('fetchPayment', () => {
  it('reports a paid invoice and offers no further link', async () => {
    fetchMock.mockResolvedValue(ok(invoice({ status: 'paid' })));

    const result = await provider.fetchPayment('inv_8f2c');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.moyasar.com/v1/invoices/inv_8f2c');
    expect(result).toEqual({ status: 'SUCCEEDED', redirectUrl: null });
  });

  it('hands back the still-payable link for an unpaid invoice', async () => {
    fetchMock.mockResolvedValue(ok(invoice({ status: 'initiated' })));

    const result = await provider.fetchPayment('inv_8f2c');

    expect(result?.status).toBe('PENDING');
    expect(result?.redirectUrl).toBe('https://api.moyasar.com/v1/invoices/inv_8f2c');
  });

  it('treats an expired invoice as failed rather than still payable', async () => {
    // FAILED here means "this link is dead", not "the order is dead" — see
    // `verifyOrderPayment`, which deliberately does not settle on it. A host
    // who abandons a checkout and comes back tomorrow must still be able to buy.
    fetchMock.mockResolvedValue(ok(invoice({ status: 'expired' })));
    const result = await provider.fetchPayment('inv_8f2c');
    expect(result?.status).toBe('FAILED');
    expect(result?.redirectUrl).toBeNull();
  });

  it('returns null rather than throwing when the gateway is unreachable', async () => {
    // The checkout calls this on return from the payment page; a gateway blip
    // must leave the order readable, not 500 the screen the payer lands on.
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    expect(await provider.fetchPayment('inv_8f2c')).toBeNull();
  });
});
