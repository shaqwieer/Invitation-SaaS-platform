import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  FetchedPayment,
  PaymentOutcome,
  PaymentProvider,
  WebhookEnvelope,
} from './index.js';

/**
 * Moyasar — ميسر.
 *
 * Wired through **Invoices**, not the Payments API. The difference matters:
 * `POST /v1/invoices` returns a hosted checkout page we send the payer to, so
 * no card number ever touches this server and the flow fits the abstraction's
 * `redirectUrl` exactly. The Payments API expects a card token or raw card
 * data, which would mean collecting PANs here — a different compliance problem
 * for no benefit.
 *
 * Amounts need no conversion. Moyasar takes "the smallest currency unit", which
 * for SAR is the halala, and every amount in this system is already an integer
 * of halalas. The one thing that would corrupt every charge on the platform is
 * a stray ×100, so there is deliberately no arithmetic in this file.
 *
 * Docs: https://docs.moyasar.com/api/invoices/01-create-invoice/
 */

const API_BASE = 'https://api.moyasar.com/v1';

/** No timeout is Node `fetch`'s default. A checkout must not hang on one. */
const TIMEOUT_MS = 15_000;

/** A payment link that outlives the wedding is a payment link for nothing. */
const INVOICE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Payment status → what settlement should do.
 *
 * The two entries that are not obvious are the two that matter most:
 *
 * `authorized` means the amount is *held*, not taken. On an account configured
 * for manual capture it arrives before any money moves, and settling on it
 * would activate a host's event against funds that were never captured.
 * `verified` is the card-verification step, likewise not a payment. Both map to
 * PENDING, which `settlePayment` early-returns on.
 */
const PAYMENT_STATUS: Record<string, PaymentOutcome | 'REFUNDED'> = {
  paid: 'SUCCEEDED',
  captured: 'SUCCEEDED',
  failed: 'FAILED',
  voided: 'FAILED',
  refunded: 'REFUNDED',
  initiated: 'PENDING',
  authorized: 'PENDING',
  verified: 'PENDING',
};

/**
 * Event type → status, used only when the payment object carries no status.
 *
 * `payment_faild` is spelled that way in Moyasar's own API. Both spellings are
 * listed because the day they fix the typo must not be the day settlement stops
 * recognising a failure.
 */
const TYPE_STATUS: Record<string, PaymentOutcome | 'REFUNDED'> = {
  payment_paid: 'SUCCEEDED',
  payment_captured: 'SUCCEEDED',
  payment_faild: 'FAILED',
  payment_failed: 'FAILED',
  payment_voided: 'FAILED',
  payment_refunded: 'REFUNDED',
  payment_authorized: 'PENDING',
  payment_verified: 'PENDING',
};

/** Invoice status → the same vocabulary. An expired link is a dead payment. */
const INVOICE_STATUS: Record<string, PaymentOutcome | 'REFUNDED'> = {
  paid: 'SUCCEEDED',
  failed: 'FAILED',
  voided: 'FAILED',
  canceled: 'FAILED',
  expired: 'FAILED',
  refunded: 'REFUNDED',
  initiated: 'PENDING',
  on_hold: 'PENDING',
};

interface MoyasarInvoice {
  id: string;
  status: string;
  url: string;
  amount: number;
  currency: string;
}

export class MoyasarGatewayError extends AppError {
  constructor(message: string) {
    super('PAYMENT_GATEWAY_ERROR', 502, message);
  }
}

export class MoyasarPaymentProvider implements PaymentProvider {
  readonly name = 'moyasar';

  private get secretKey(): string {
    // Boot already refuses to start without it (see `env.ts`); this only keeps
    // the type honest.
    return env().MOYASAR_SECRET_KEY ?? '';
  }

  /** Test keys must never settle a live order, or the reverse. */
  private get isLive(): boolean {
    return this.secretKey.startsWith('sk_live_');
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const invoice = await this.request<MoyasarInvoice>('POST', '/invoices', {
      // No conversion — see the note at the top of this file.
      amount: input.amountHalalas,
      currency: input.currency,
      description: input.description ?? `طلب ${input.orderNumber}`,
      success_url: input.returnUrl,
      back_url: input.returnUrl,
      expired_at: new Date(Date.now() + INVOICE_TTL_MS).toISOString(),
      /*
       * Metadata is string→string at Moyasar's end; anything else is rejected
       * or silently stringified. The order id rides here so a delivery can be
       * traced back to an order even when the payment row has gone missing.
       *
       * `method` is what the host picked in our checkout. Moyasar's hosted page
       * asks again and the payer's answer there is the one that counts, so this
       * is recorded intent, not an instruction.
       */
      metadata: {
        order_id: String(input.orderId),
        order_number: String(input.orderNumber),
        method: String(input.method),
      },
    });

    return {
      providerPaymentId: String(invoice.id),
      redirectUrl: invoice.url ? String(invoice.url) : null,
      status: (INVOICE_STATUS[String(invoice.status)] ?? 'PENDING') as PaymentOutcome,
    };
  }

  /**
   * Read an invoice back.
   *
   * Keyed on the invoice id because that is what `createPayment` stored — see
   * the note in `parseWebhook` about why the two ids are not interchangeable.
   */
  async fetchPayment(providerPaymentId: string): Promise<FetchedPayment | null> {
    const invoice = await this.request<MoyasarInvoice>(
      'GET',
      `/invoices/${encodeURIComponent(providerPaymentId)}`,
    ).catch((err: unknown) => {
      logger.warn({ providerPaymentId, err }, '[payment:moyasar] could not read invoice');
      return null;
    });

    if (!invoice) return null;

    const status = INVOICE_STATUS[String(invoice.status)] ?? 'PENDING';
    return {
      status,
      // Only worth handing back while it can still be paid.
      redirectUrl: status === 'PENDING' && invoice.url ? String(invoice.url) : null,
    };
  }

  /**
   * Moyasar authenticates a delivery with a token *in the body*, not a header.
   *
   * The interface hands over the raw bytes and a header value; the raw bytes are
   * what this needs, and the header is ignored. Keeping the shape means the
   * webhook route does not grow a per-provider branch, and the raw body is
   * exactly what has to be read anyway — the parsed one has already been through
   * a round trip we would rather not trust for an authentication decision.
   *
   * Fails closed twice over: an unconfigured or placeholder secret rejects
   * everything rather than accepting everything, which is the failure mode that
   * turns a public endpoint into a way to mark orders paid.
   */
  verifySignature(rawBody: Buffer, _signature: string | undefined): boolean {
    const configured = env().PAYMENT_WEBHOOK_SECRET;
    if (!configured || /dev|change_me|secret_here/i.test(configured)) {
      logger.error('[payment:moyasar] webhook secret is unset or still a placeholder — refusing');
      return false;
    }

    let token: string;
    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      token = typeof parsed.secret_token === 'string' ? parsed.secret_token : '';
    } catch {
      return false;
    }

    if (!token) return false;

    const a = Buffer.from(token);
    const b = Buffer.from(configured);

    // Length is not the secret; the token is. Constant-time so a near-miss
    // leaks nothing about how much of it was right.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): WebhookEnvelope | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const body = payload as Record<string, unknown>;

    const providerEventId = String(body.id ?? '');
    const type = String(body.type ?? '');
    const data = typeof body.data === 'object' && body.data ? (body.data as Record<string, unknown>) : null;

    if (!providerEventId || !data) return null;

    // A test-mode delivery must never settle a live order, nor the reverse.
    // Signed correctly but from the wrong world — recorded and ignored, which
    // is what the route does with a null envelope.
    if (typeof body.live === 'boolean' && body.live !== this.isLive) {
      logger.warn({ providerEventId, live: body.live }, '[payment:moyasar] wrong-mode delivery ignored');
      return null;
    }

    /*
     * The id we stored is the *invoice* id; the id in `data` is the *payment*
     * id. They are different objects, and settlement looks the payment row up
     * by what `createPayment` wrote — so sending `data.id` here would find
     * nothing and every real payment would be logged as "settlement for an
     * unknown payment" while the order sat unpaid. `invoice_id` is the join.
     *
     * The fallback to `data.id` covers a payment made outside an invoice, which
     * this integration does not create but a dashboard refund could.
     */
    const providerPaymentId = data.invoice_id ? String(data.invoice_id) : String(data.id ?? '');
    if (!providerPaymentId) return null;

    const rawStatus = String(data.status ?? '');
    const status = PAYMENT_STATUS[rawStatus] ?? TYPE_STATUS[type];
    if (!status) {
      logger.warn({ providerEventId, type, rawStatus }, '[payment:moyasar] unmapped status');
      return null;
    }

    const metadata =
      typeof data.metadata === 'object' && data.metadata
        ? (data.metadata as Record<string, unknown>)
        : {};

    return {
      providerEventId,
      providerPaymentId,
      type: type || 'payment.updated',
      status,
      amountHalalas: typeof data.amount === 'number' ? data.amount : null,
      orderId: metadata.order_id ? String(metadata.order_id) : null,
    };
  }

  /**
   * One HTTP call to Moyasar.
   *
   * HTTP Basic with the secret key as the username and an empty password, which
   * is what their docs specify (`curl … -u sk_test_123:`).
   */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.secretKey}:`).toString('base64');

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      logger.error({ err, path, method }, '[payment:moyasar] request did not complete');
      throw new MoyasarGatewayError('Could not reach the payment gateway');
    }

    if (!res.ok) {
      // Never log the body of a 401: an auth failure is the one response most
      // likely to quote the credential back, and this goes to a log file.
      const detail = res.status === 401 ? '' : await res.text().catch(() => '');
      logger.error(
        { status: res.status, path, method, detail: detail.slice(0, 300) },
        '[payment:moyasar] gateway refused the request',
      );
      throw new MoyasarGatewayError(`Payment gateway returned ${res.status}`);
    }

    return (await res.json()) as T;
  }
}
