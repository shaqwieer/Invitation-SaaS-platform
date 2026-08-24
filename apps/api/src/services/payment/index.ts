import crypto from 'node:crypto';
import type { PaymentMethodValue } from '@da3wa/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { MoyasarPaymentProvider } from './moyasar.js';

/**
 * Provider-agnostic payments.
 *
 * Everything the rest of the API knows about a gateway lives behind this
 * interface. Swapping the stub for Moyasar, Tap or HyperPay means writing one
 * class — no caller changes, because no caller ever sees a provider-specific
 * shape.
 */

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  amountHalalas: number;
  currency: string;
  method: PaymentMethodValue;
  /** Where the payer comes back to once the gateway is done with them. */
  returnUrl: string;
  customer: { name: string; phone: string };
  /** Shown to the payer on the gateway's own page. Falls back to the number. */
  description?: string;
}

export type PaymentOutcome = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface CreatePaymentResult {
  providerPaymentId: string;
  /** Non-null when the provider hosts its own payment page. */
  redirectUrl: string | null;
  status: PaymentOutcome;
}

/** The provider-neutral shape a webhook is normalized into. */
export interface WebhookEnvelope {
  /** The gateway's own id for this delivery — the idempotency key. */
  providerEventId: string;
  providerPaymentId: string;
  type: string;
  status: PaymentOutcome | 'REFUNDED';
  amountHalalas: number | null;
  orderId: string | null;
}

/** What the gateway says about a payment when we go and ask it directly. */
export interface FetchedPayment {
  status: PaymentOutcome | 'REFUNDED';
  /** The hosted page, still usable while the payment is unpaid. */
  redirectUrl: string | null;
}

export interface PaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Ask the gateway what actually happened, rather than waiting to be told.
   *
   * Optional, because a provider that settles synchronously has nothing to ask.
   * For a redirect gateway it closes two holes that webhooks alone leave open:
   *
   *   - The payer returns from the hosted page before the webhook lands — or
   *     before anyone has configured one — and the checkout would otherwise
   *     show a pay button for an order that is already paid. That is how a
   *     customer gets charged twice.
   *   - A second click on «ادفع» would open a second invoice for the same
   *     order, both payable. Re-reading the first one is what prevents it.
   */
  fetchPayment?(providerPaymentId: string): Promise<FetchedPayment | null>;

  /**
   * Verify the delivery came from the gateway.
   *
   * Takes the **raw** body, not the parsed object: every real gateway signs the
   * exact bytes it sent, and `JSON.stringify(JSON.parse(body))` is not
   * byte-identical to the original — key order and number formatting both drift.
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;

  parseWebhook(payload: unknown): WebhookEnvelope | null;
}

/**
 * Local stub.
 *
 * Settles synchronously so the whole order flow is exercisable without a
 * gateway account — but it still goes through the same settlement function a
 * real webhook does, so the pipeline that matters is never bypassed in
 * development and untested until launch day.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    logger.info(
      { orderNumber: input.orderNumber, amountHalalas: input.amountHalalas, method: input.method },
      '[payment:stub] payment accepted without contacting a gateway',
    );

    return {
      providerPaymentId: `stub_${input.orderId}_${Date.now().toString(36)}`,
      redirectUrl: null,
      status: 'SUCCEEDED',
    };
  }

  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const expected = crypto
      .createHmac('sha256', env().PAYMENT_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);

    // Length is not secret; the digest is. Compared in constant time so a
    // forged signature leaks nothing about how much of it was right.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): WebhookEnvelope | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const body = payload as Record<string, unknown>;

    const providerEventId = String(body.id ?? '');
    const providerPaymentId = String(body.paymentId ?? '');
    if (!providerEventId || !providerPaymentId) return null;

    const status = String(body.status ?? '').toUpperCase();
    if (!['SUCCEEDED', 'FAILED', 'REFUNDED', 'PENDING'].includes(status)) return null;

    return {
      providerEventId,
      providerPaymentId,
      type: String(body.type ?? 'payment.updated'),
      status: status as WebhookEnvelope['status'],
      amountHalalas: typeof body.amount === 'number' ? body.amount : null,
      orderId: body.orderId ? String(body.orderId) : null,
    };
  }

  /** Test/dev helper: sign a body exactly as the gateway would. */
  static sign(rawBody: Buffer, secret: string): string {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}

let instance: PaymentProvider | null = null;

export function paymentProvider(): PaymentProvider {
  if (instance) return instance;

  switch (env().PAYMENT_PROVIDER) {
    case 'moyasar':
      instance = new MoyasarPaymentProvider();
      break;
    case 'stub':
    default:
      instance = new StubPaymentProvider();
  }

  return instance;
}

/** Test seam — swap in a provider without touching env. */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  instance = provider;
}
