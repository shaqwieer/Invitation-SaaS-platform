import { z } from 'zod';

export const paymentMethodSchema = z.enum(['MADA', 'CREDIT_CARD', 'APPLE_PAY', 'BANK_TRANSFER']);
export type PaymentMethodValue = z.infer<typeof paymentMethodSchema>;

/**
 * mada first, deliberately.
 *
 * It is the dominant card in Saudi Arabia, and the design orders the options by
 * actual use rather than by what a Western checkout would list first — a host
 * who has to scroll past two irrelevant options hesitates.
 */
export const PAYMENT_METHOD_ORDER: PaymentMethodValue[] = [
  'MADA',
  'CREDIT_CARD',
  'APPLE_PAY',
  'BANK_TRANSFER',
];

/**
 * What the client may ask for.
 *
 * Note what is absent: any price. The server reads every amount from the
 * catalogue, so a tampered request can change *what* is bought but never what
 * it costs.
 */
export const createOrderSchema = z.object({
  eventId: z.string().min(1),
  packageId: z.string().min(1),
  /** Template keys charged on top, e.g. the +199 custom-card upload. */
  addonTemplateIds: z.array(z.string().min(1)).max(5).default([]),
  discountCode: z.string().trim().max(40).optional(),
  method: paymentMethodSchema.optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const payOrderSchema = z.object({
  method: paymentMethodSchema,
});
export type PayOrderInput = z.infer<typeof payOrderSchema>;

export interface OrderLineItemView {
  key: string;
  labelAr: string;
  labelEn: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  method: PaymentMethodValue | null;

  lineItems: OrderLineItemView[];
  /** All amounts are integer halalas. */
  subtotalHalalas: number;
  discountHalalas: number;
  vatRateBps: number;
  vatHalalas: number;
  totalHalalas: number;
  currency: string;

  event: { id: string; title: string } | null;
  package: { id: string; nameAr: string; nameEn: string; guestCap: number } | null;

  paidAt: string | null;
  createdAt: string;
}

/** What a provider hands back when a payment is opened. */
export interface PaymentIntentView {
  providerPaymentId: string;
  /** Where to send the payer, when the provider hosts its own page. */
  redirectUrl: string | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}
