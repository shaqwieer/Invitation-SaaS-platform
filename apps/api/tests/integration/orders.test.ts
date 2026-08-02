/**
 * Orders, payments and webhooks.
 *
 * Two properties carry this suite: the server prices the order (a client can
 * choose *what* it buys, never what it costs), and a retried gateway delivery
 * cannot apply a payment twice.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow, Package } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  StubPaymentProvider,
  setPaymentProvider,
  type CreatePaymentInput,
  type CreatePaymentResult,
} from '../../src/services/payment/index.js';
import {
  setNotificationHook,
  type NewOrderNotification,
  type NotificationHook,
} from '../../src/services/notifications/index.js';
import { createEvent, createUser, loginAs, resetDb, type Session } from '../helpers/factories.js';

let app: Express;
let host: Session;
let intruder: Session;
let event: EventRow;
let pkg: Package;
let addonId: string;

const WEBHOOK_SECRET = 'dev_webhook_secret';

/** Sign a body exactly as a gateway would — over the bytes actually sent. */
function signed(body: unknown) {
  const raw = Buffer.from(JSON.stringify(body));
  return { raw, signature: StubPaymentProvider.sign(raw, WEBHOOK_SECRET) };
}

function postWebhook(body: unknown, signature?: string) {
  const { raw, signature: real } = signed(body);
  return request(app)
    .post('/api/webhooks/stub')
    .set('Content-Type', 'application/json')
    .set('X-Signature', signature ?? real)
    .send(raw.toString());
}

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(null);
  setNotificationHook({ name: 'noop', onNewOrder: async () => undefined });

  const [a, b] = await Promise.all([createUser(), createUser()]);
  [host, intruder] = await Promise.all([loginAs(app, a), loginAs(app, b)]);
  event = await createEvent(a.id, { status: 'DRAFT' });

  pkg = await prisma.package.create({
    data: {
      key: 'event-300',
      nameAr: 'باقة المناسبة',
      nameEn: 'Event package',
      guestCap: 300,
      priceHalalas: 44_900, // 449.00 SAR
    },
  });

  const addon = await prisma.template.create({
    data: {
      key: 'custom-upload',
      nameAr: 'تصميم بطاقة مخصص',
      nameEn: 'Custom card design',
      priceHalalas: 19_900, // 199.00 SAR
    },
  });
  addonId = addon.id;
});

afterEach(() => {
  setPaymentProvider(null);
  vi.restoreAllMocks();
});

describe('creating an order', () => {
  it('reproduces the design’s invoice', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id, addonTemplateIds: [addonId] });

    expect(res.status).toBe(201);
    // 449 + 199 = 648, VAT 97.20, total 745.20 — §11's numbers exactly.
    expect(res.body.order.subtotalHalalas).toBe(64_800);
    expect(res.body.order.vatHalalas).toBe(9_720);
    expect(res.body.order.totalHalalas).toBe(74_520);
    expect(res.body.order.vatRateBps).toBe(1500);
    expect(res.body.order.orderNumber).toMatch(/^DW-\d{4}-\d{4}$/);
  });

  it('ignores any price the client sends', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({
        eventId: event.id,
        packageId: pkg.id,
        // Every shape a tampering client might try.
        totalHalalas: 1,
        subtotalHalalas: 1,
        priceHalalas: 1,
        amount: 1,
        lineItems: [{ key: 'free', unitPrice: 0, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    // Priced from the catalogue, and nothing in the request could change it.
    expect(res.body.order.subtotalHalalas).toBe(44_900);
    expect(res.body.order.totalHalalas).toBe(51_635);
    expect(res.body.order.lineItems).toHaveLength(1);
    expect(res.body.order.lineItems[0].unitPrice).toBe(44_900);
  });

  it('rejects an unknown or inactive package', async () => {
    const inactive = await prisma.package.create({
      data: {
        key: 'retired',
        nameAr: 'قديمة',
        nameEn: 'Retired',
        guestCap: 50,
        priceHalalas: 100,
        isActive: false,
      },
    });

    for (const packageId of ['does-not-exist', inactive.id]) {
      const res = await request(app)
        .post('/api/orders')
        .set(...host.auth())
        .send({ eventId: event.id, packageId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PACKAGE_NOT_FOUND');
    }
  });

  it('rejects an unknown add-on rather than silently dropping it', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id, addonTemplateIds: [addonId, 'nope'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ADDON_NOT_FOUND');
  });

  it('says plainly that discount codes are not available yet', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id, discountCode: 'EID2026' });

    // Silently ignoring a code the host believes they applied is worse than
    // refusing it.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DISCOUNT_NOT_AVAILABLE');
  });

  it('cancels an abandoned checkout when a new one starts', async () => {
    const first = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id });

    await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id, addonTemplateIds: [addonId] })
      .expect(201);

    const abandoned = await prisma.order.findUniqueOrThrow({ where: { id: first.body.order.id } });
    expect(abandoned.status).toBe('CANCELLED');
    expect(await prisma.order.count({ where: { eventId: event.id, status: 'PENDING' } })).toBe(1);
  });
});

describe('paying', () => {
  async function createPending() {
    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id });
    return res.body.order.id as string;
  }

  it('marks the order paid and activates the event', async () => {
    const orderId = await createPending();

    const res = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('PAID');
    expect(res.body.order.paidAt).toBeTruthy();

    // Activation is the thing the host actually bought: the package is what
    // lifts the send-time guest cap.
    const activated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(activated.packageId).toBe(pkg.id);
    expect(activated.status).toBe('ACTIVE');
  });

  it('fires the new-order notification exactly once', async () => {
    // Typed so the assertion below can read the payload rather than an `any`.
    const onNewOrder = vi.fn(async (_order: NewOrderNotification) => undefined);
    setNotificationHook({ name: 'spy', onNewOrder } as NotificationHook);

    const orderId = await createPending();
    await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' })
      .expect(200);

    expect(onNewOrder).toHaveBeenCalledTimes(1);
    expect(onNewOrder.mock.calls[0]![0]).toMatchObject({ totalHalalas: 51_635 });
  });

  it('does not let a notification failure undo a payment', async () => {
    setNotificationHook({
      name: 'broken',
      onNewOrder: async () => {
        throw new Error('slack is down');
      },
    });

    const orderId = await createPending();
    const res = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' });

    // The money has already moved; a Slack outage must not turn that into a
    // failed request.
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('PAID');
  });

  it('refuses to pay the same order twice', async () => {
    const orderId = await createPending();
    await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' })
      .expect(200);

    const again = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ORDER_ALREADY_PAID');
  });
});

describe('webhooks', () => {
  /** A provider that defers settlement, so the webhook path is what pays. */
  function deferringProvider() {
    const base = new StubPaymentProvider();
    setPaymentProvider({
      name: 'stub',
      createPayment: async (input: CreatePaymentInput): Promise<CreatePaymentResult> => ({
        providerPaymentId: `pay_${input.orderId}`,
        redirectUrl: 'https://gateway.example/pay/abc',
        status: 'PENDING',
      }),
      verifySignature: base.verifySignature.bind(base),
      parseWebhook: base.parseWebhook.bind(base),
    });
  }

  async function pendingPayment() {
    deferringProvider();

    const created = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id });

    const orderId = created.body.order.id as string;

    const paid = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' });

    // A real gateway hands back a redirect and settles later.
    expect(paid.body.order.status).toBe('PENDING');
    expect(paid.body.redirectUrl).toContain('gateway.example');

    return { orderId, providerPaymentId: `pay_${orderId}` };
  }

  it('settles the order', async () => {
    const { orderId, providerPaymentId } = await pendingPayment();

    const res = await postWebhook({
      id: 'evt_1',
      paymentId: providerPaymentId,
      type: 'payment.succeeded',
      status: 'SUCCEEDED',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');
  });

  it('ignores a replayed delivery', async () => {
    const { orderId, providerPaymentId } = await pendingPayment();
    const body = {
      id: 'evt_replay',
      paymentId: providerPaymentId,
      type: 'payment.succeeded',
      status: 'SUCCEEDED',
    };

    await postWebhook(body).expect(200);
    const replay = await postWebhook(body);

    // Every gateway retries. The unique constraint on (provider,
    // providerEventId) is what stops a retry double-applying a payment.
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('duplicate');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it('notifies once even when the gateway delivers three times', async () => {
    const onNewOrder = vi.fn(async (_order: NewOrderNotification) => undefined);
    setNotificationHook({ name: 'spy', onNewOrder } as NotificationHook);

    const { providerPaymentId } = await pendingPayment();
    const body = { id: 'evt_thrice', paymentId: providerPaymentId, type: 'x', status: 'SUCCEEDED' };

    await postWebhook(body).expect(200);
    await postWebhook(body).expect(200);
    await postWebhook(body).expect(200);

    expect(onNewOrder).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged signature', async () => {
    const { orderId, providerPaymentId } = await pendingPayment();

    const res = await postWebhook(
      { id: 'evt_forged', paymentId: providerPaymentId, type: 'x', status: 'SUCCEEDED' },
      crypto.randomBytes(32).toString('hex'),
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PENDING');
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a delivery with no signature at all', async () => {
    const res = await request(app)
      .post('/api/webhooks/stub')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'x', paymentId: 'y', status: 'SUCCEEDED' }));

    expect(res.status).toBe(401);
  });

  it('detects a body edited after signing', async () => {
    const { providerPaymentId } = await pendingPayment();
    const original = { id: 'evt_edit', paymentId: providerPaymentId, type: 'x', status: 'FAILED' };
    const { signature } = signed(original);

    // Same signature, different body — the classic tamper.
    const res = await postWebhook({ ...original, status: 'SUCCEEDED' }, signature);
    expect(res.status).toBe(401);
  });

  it('acknowledges a signed payload it does not understand', async () => {
    const res = await postWebhook({ hello: 'world' });

    // A 500 here makes the gateway retry forever and eventually disable the
    // endpoint — far worse than one ignored message.
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ignored');
  });

  it('acknowledges a settlement for a payment it has never seen', async () => {
    const res = await postWebhook({
      id: 'evt_unknown',
      paymentId: 'pay_from_another_system',
      type: 'x',
      status: 'SUCCEEDED',
    });

    expect(res.status).toBe(200);
  });

  it('marks a failed payment without activating anything', async () => {
    const { orderId, providerPaymentId } = await pendingPayment();

    await postWebhook({
      id: 'evt_failed',
      paymentId: providerPaymentId,
      type: 'payment.failed',
      status: 'FAILED',
    }).expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('FAILED');

    const stillDraft = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stillDraft.packageId).toBeNull();
  });

  it('404s an unconfigured provider', async () => {
    const res = await request(app)
      .post('/api/webhooks/moyasar')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'whatever')
      .send(JSON.stringify({ id: 'x' }));

    expect(res.status).toBe(404);
  });
});

describe('cross-tenant isolation', () => {
  it('refuses to create an order against another host’s event', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(...intruder.auth())
      .send({ eventId: event.id, packageId: pkg.id });

    expect(res.status).toBe(404);
    expect(await prisma.order.count()).toBe(0);
  });

  it('refuses to read or pay another host’s order', async () => {
    const created = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id });

    const orderId = created.body.order.id;

    await request(app)
      .get(`/api/orders/${orderId}`)
      .set(...intruder.auth())
      .expect(404);

    await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...intruder.auth())
      .send({ method: 'MADA' })
      .expect(404);

    const untouched = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(untouched.status).toBe('PENDING');
  });

  it('lists only the caller’s own orders', async () => {
    await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id });

    const mine = await request(app)
      .get('/api/orders')
      .set(...host.auth());
    const theirs = await request(app)
      .get('/api/orders')
      .set(...intruder.auth());

    expect(mine.body.orders).toHaveLength(1);
    expect(theirs.body.orders).toHaveLength(0);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/orders').expect(401);
    await request(app).post('/api/orders').send({}).expect(401);
  });
});
