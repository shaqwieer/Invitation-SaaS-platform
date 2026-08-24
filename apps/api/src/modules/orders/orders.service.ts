import { Prisma, type Event, type Order, type User } from '@prisma/client';
import {
  computeOrderTotals,
  formatOrderNumber,
  type CreateOrderInput,
  type OrderLineItem,
  type OrderView,
  type PaymentMethodValue,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { paymentProvider } from '../../services/payment/index.js';
import { notifyNewOrder } from '../../services/notifications/index.js';
import { pendingCharge as pendingDesignCharge } from '../design/design.service.js';

/** VAT as basis points, so the stored rate is an integer like every amount. */
const VAT_RATE_BPS = Math.round(0.15 * 10_000);

/**
 * Line-item key prefix for a custom design charge.
 *
 * The request id is appended, which is what lets settlement find the row to
 * stamp as billed — the frozen line item is the only link between a paid order
 * and the design job it paid for.
 */
const CUSTOM_DESIGN_LINE_KEY = 'custom-design';

function toView(
  order: Order & {
    event?: { id: string; title: string } | null;
    package?: { id: string; nameAr: string; nameEn: string; guestCap: number } | null;
  },
): OrderView {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    method: order.method,
    lineItems: order.lineItems as unknown as OrderView['lineItems'],
    subtotalHalalas: order.subtotalHalalas,
    discountHalalas: order.discountHalalas,
    vatRateBps: order.vatRateBps,
    vatHalalas: order.vatHalalas,
    totalHalalas: order.totalHalalas,
    currency: order.currency,
    event: order.event ?? null,
    package: order.package ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

export const ORDER_INCLUDE = {
  event: { select: { id: true, title: true } },
  package: { select: { id: true, nameAr: true, nameEn: true, guestCap: true } },
} satisfies Prisma.OrderInclude;

/**
 * DW-2026-0001 — one past the highest number already issued this year.
 *
 * Derived from the maximum rather than a row count, because a count can go
 * *down*. `Order.userId` cascades on user delete, so removing an account would
 * shrink the count and hand a future order an invoice number that has already
 * been issued. Gaps in an invoice sequence are unremarkable; reuse is not.
 *
 * The suffix is cast to an integer in SQL rather than compared as text, so the
 * ordering stays correct past DW-2026-9999 where lexicographic comparison would
 * quietly put 9999 above 10000.
 *
 * Two hosts checking out in the same instant still compute the same number, so
 * the caller retries on the unique constraint rather than trusting this alone.
 */
/**
 * Recover the design request id from an order's frozen line items.
 *
 * Reading the key back is what makes billing idempotent without a second
 * column on Order: the line item is written once, at checkout, and settlement
 * — which a gateway may deliver more than once — derives everything from it.
 */
function customDesignRequestId(lineItems: unknown): string | null {
  if (!Array.isArray(lineItems)) return null;

  for (const item of lineItems as Array<{ key?: unknown }>) {
    if (typeof item?.key !== 'string') continue;
    if (item.key.startsWith(`${CUSTOM_DESIGN_LINE_KEY}:`)) {
      return item.key.slice(CUSTOM_DESIGN_LINE_KEY.length + 1) || null;
    }
  }

  return null;
}

async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();

  const rows = await prisma.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(split_part("orderNumber", '-', 3) AS INTEGER)) AS max
    FROM "Order"
    WHERE "orderNumber" LIKE ${`DW-${year}-%`}
  `;

  return formatOrderNumber(year, Number(rows[0]?.max ?? 0) + 1);
}

/**
 * Price an order from the catalogue.
 *
 * Nothing in the request carries an amount. A client can change *what* it is
 * buying — and that is validated against the catalogue too — but there is no
 * field in which it could state what that costs. This is the difference between
 * a checkout and a donation box.
 */
export async function createOrder(
  user: User,
  event: Event,
  input: CreateOrderInput,
): Promise<OrderView> {
  if (input.discountCode) {
    // Discount codes need a catalogue model that does not exist yet. Rejecting
    // clearly beats silently ignoring a code the host believes they applied.
    throw new BadRequestError('Discount codes are not available yet', 'DISCOUNT_NOT_AVAILABLE');
  }

  const pkg = await prisma.package.findFirst({
    where: { id: input.packageId, isActive: true },
  });
  if (!pkg) throw new BadRequestError('Unknown package', 'PACKAGE_NOT_FOUND');

  const addons = input.addonTemplateIds.length
    ? await prisma.template.findMany({
        where: { id: { in: input.addonTemplateIds }, isActive: true },
      })
    : [];

  if (addons.length !== input.addonTemplateIds.length) {
    throw new BadRequestError('Unknown add-on', 'ADDON_NOT_FOUND');
  }

  /*
   * The custom design, at the price the operator quoted for this job.
   *
   * Read from the request row rather than the catalogue, because «بسعر خاص» is
   * the point — the figure was agreed on a phone call about one wedding, and no
   * catalogue entry can hold it. It is still the *server* that supplies the
   * amount: like everything else here, the client says what is being bought and
   * never what it costs.
   *
   * Skipped once billed, so an upgrade order later in the same event does not
   * charge for the design a second time.
   */
  const designCharge = await pendingDesignCharge(event.id);

  const lineItems: OrderLineItem[] = [
    {
      key: `package:${pkg.key}`,
      labelAr: pkg.nameAr,
      labelEn: pkg.nameEn,
      unitPrice: pkg.priceHalalas,
      quantity: 1,
    },
    ...addons
      .filter((addon) => addon.priceHalalas > 0)
      .map((addon) => ({
        key: `addon:${addon.key}`,
        labelAr: addon.nameAr,
        labelEn: addon.nameEn,
        unitPrice: addon.priceHalalas,
        quantity: 1,
      })),
    ...(designCharge?.priceHalalas
      ? [
          {
            key: `${CUSTOM_DESIGN_LINE_KEY}:${designCharge.id}`,
            labelAr: 'تصميم بطاقة مخصص',
            labelEn: 'Custom card design',
            unitPrice: designCharge.priceHalalas,
            quantity: 1,
          },
        ]
      : []),
  ];

  const totals = computeOrderTotals({ lineItems, vatRate: env().VAT_RATE });

  // One live checkout per event: an abandoned attempt should not sit around
  // looking payable next to the one the host is actually completing.
  await prisma.order.updateMany({
    where: { eventId: event.id, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await prisma.order.create({
        data: {
          orderNumber: await nextOrderNumber(),
          userId: user.id,
          eventId: event.id,
          packageId: pkg.id,
          status: 'PENDING',
          ...(input.method ? { method: input.method } : {}),
          lineItems: lineItems as unknown as Prisma.InputJsonValue,
          subtotalHalalas: totals.subtotal,
          discountHalalas: totals.discount,
          vatRateBps: VAT_RATE_BPS,
          vatHalalas: totals.vat,
          totalHalalas: totals.total,
          currency: env().CURRENCY,
          provider: paymentProvider().name,
        },
        include: ORDER_INCLUDE,
      });

      await audit({
        action: 'order.create',
        actorId: user.id,
        eventId: event.id,
        targetType: 'Order',
        targetId: order.id,
        meta: { orderNumber: order.orderNumber, total: totals.total },
      });

      return toView(order);
    } catch (err) {
      // Another checkout took our sequence number; recount and try again.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }

  throw new ConflictError('Could not allocate an order number', 'ORDER_NUMBER_ALLOCATION_FAILED');
}

export async function getOrder(user: User, orderId: string): Promise<OrderView> {
  const order = await prisma.order.findFirst({
    // Scoped by owner, so another host's order id is simply not found.
    where: { id: orderId, ...(user.role === 'ADMIN' ? {} : { userId: user.id }) },
    include: ORDER_INCLUDE,
  });

  if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
  return toView(order);
}

export async function listOrders(user: User): Promise<OrderView[]> {
  const orders = await prisma.order.findMany({
    where: user.role === 'ADMIN' ? {} : { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: ORDER_INCLUDE,
  });
  return orders.map(toView);
}

export interface PayResult {
  order: OrderView;
  redirectUrl: string | null;
}

/**
 * Open a payment with the provider.
 *
 * A real gateway answers PENDING with a redirect and settles later by webhook;
 * the stub answers SUCCEEDED here. Either way settlement runs through
 * `settlePayment`, so the path that matters in production is the one exercised
 * in development rather than a shortcut that gets its first real run at launch.
 */
export async function payOrder(
  user: User,
  orderId: string,
  method: PaymentMethodValue,
  locale: 'ar' | 'en' = 'ar',
): Promise<PayResult> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    include: ORDER_INCLUDE,
  });

  if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
  if (order.status === 'PAID')
    throw new ConflictError('Order is already paid', 'ORDER_ALREADY_PAID');
  if (order.status !== 'PENDING') {
    throw new ConflictError('Order can no longer be paid', 'ORDER_NOT_PAYABLE');
  }

  const provider = paymentProvider();

  /*
   * A second click must not open a second payable invoice.
   *
   * Harmless with the stub, which settles in place. With a real gateway it
   * leaves two live payment links against one order, and a host who pays the
   * one still open in another tab has paid twice for the same event. Re-reading
   * the existing one is the whole fix.
   */
  const pending = await prisma.payment.findFirst({
    where: { orderId: order.id, provider: provider.name, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });

  if (pending?.providerPaymentId && provider.fetchPayment) {
    const existing = await provider.fetchPayment(pending.providerPaymentId);

    // Paid while we were not looking — settle rather than charge again.
    if (existing?.status === 'SUCCEEDED') {
      await settlePayment(pending.providerPaymentId, 'SUCCEEDED');
      return { order: await getOrder(user, order.id), redirectUrl: null };
    }

    if (existing?.redirectUrl) {
      await prisma.order.update({ where: { id: order.id }, data: { method } });
      return { order: await getOrder(user, order.id), redirectUrl: existing.redirectUrl };
    }
  }

  const intent = await provider.createPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountHalalas: order.totalHalalas,
    currency: order.currency,
    method,
    /*
     * The locale segment is not optional. The web checkout lives at
     * `/{locale}/checkout/:id`, so a gateway returning the payer to
     * `/checkout/:id` drops them on a 404 having just paid. `?verify=1` is what
     * tells that page to ask the gateway directly rather than trust that the
     * webhook has already landed.
     */
    returnUrl: `${env().PUBLIC_WEB_URL}/${locale}/checkout/${order.id}?verify=1`,
    customer: { name: user.name, phone: user.phone },
    description: order.package
      ? `${order.package.nameAr} — ${order.orderNumber}`
      : `طلب ${order.orderNumber}`,
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: provider.name,
      providerPaymentId: intent.providerPaymentId,
      amountHalalas: order.totalHalalas,
      status: intent.status === 'SUCCEEDED' ? 'PENDING' : 'PENDING',
    },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { method, providerRef: intent.providerPaymentId },
  });

  if (intent.status === 'SUCCEEDED') {
    await settlePayment(intent.providerPaymentId, 'SUCCEEDED');
  }

  return {
    order: await getOrder(user, order.id),
    redirectUrl: intent.redirectUrl,
  };
}

/**
 * Ask the gateway what happened, and settle on the answer.
 *
 * Called when the payer lands back on the checkout from a hosted payment page.
 * Webhooks are the authoritative path and this does not replace them — it
 * closes the window where the payer has arrived and the delivery has not, and
 * the larger hole where nobody configured the webhook at all. In both cases the
 * checkout would otherwise show a pay button for an order already paid, which
 * is how a customer pays twice.
 *
 * Settles through `settlePayment` like everything else, so a webhook that lands
 * a second later changes nothing.
 */
export async function verifyOrderPayment(user: User, orderId: string): Promise<OrderView> {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId: user.id } });
  if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');

  const provider = paymentProvider();

  // Nothing to ask about: already resolved, never sent to a gateway, or a
  // provider that settles in place and has no endpoint to query.
  if (order.status !== 'PENDING' || !order.providerRef || !provider.fetchPayment) {
    return getOrder(user, orderId);
  }

  const fetched = await provider.fetchPayment(order.providerRef);

  /*
   * Only a payment that actually happened is settled here.
   *
   * A hosted invoice that is expired, cancelled or has a declined attempt
   * against it reads as FAILED, and settling that would mark the *order* FAILED
   * — after which `payOrder` refuses it as ORDER_NOT_PAYABLE and the host can
   * never buy that package again. Abandoning a checkout and coming back the
   * next day is enough to reach it, because the invoice expires in 24 hours.
   *
   * Leaving the order PENDING loses nothing: the invoice dies on its own, and
   * the next «ادفع» opens a fresh one. A genuinely terminal outcome still
   * arrives through the webhook.
   */
  if (fetched && (fetched.status === 'SUCCEEDED' || fetched.status === 'REFUNDED')) {
    await settlePayment(order.providerRef, fetched.status);
  }

  return getOrder(user, orderId);
}

/**
 * Apply a settled payment.
 *
 * The single place an order becomes PAID, called by the synchronous stub, the
 * webhook, and the return-from-gateway check. Idempotent by design: a gateway
 * that retries a delivery, or delivers out of order, must not double-activate
 * an event or fire the new-order notification twice.
 */
export async function settlePayment(
  providerPaymentId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PENDING',
  /** What the gateway says was actually moved, when it says so. */
  settledHalalas?: number | null,
): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { providerPaymentId },
    include: { order: { include: { user: true, event: true, package: true } } },
  });

  if (!payment) {
    logger.warn({ providerPaymentId }, 'settlement for an unknown payment — ignoring');
    return;
  }

  const { order } = payment;

  /*
   * A partial capture would otherwise settle as if it were the full amount.
   *
   * Not a refusal — the gateway is the authority on what moved, and blocking a
   * settled payment over a mismatch would leave a paying host with a dead
   * event. It is logged loudly so a short payment is discoverable rather than
   * silently accepted as full.
   */
  if (
    typeof settledHalalas === 'number' &&
    settledHalalas !== payment.amountHalalas &&
    status === 'SUCCEEDED'
  ) {
    logger.error(
      {
        orderNumber: order.orderNumber,
        expectedHalalas: payment.amountHalalas,
        settledHalalas,
      },
      'settled amount does not match the order total',
    );
  }

  if (status === 'PENDING') return;

  if (status !== 'SUCCEEDED') {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: status === 'REFUNDED' ? 'REFUNDED' : 'FAILED' },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { status: status === 'REFUNDED' ? 'REFUNDED' : 'FAILED' },
      }),
    ]);
    return;
  }

  // Already settled — a retried webhook lands here and must change nothing.
  if (order.status === 'PAID') {
    logger.info({ orderNumber: order.orderNumber }, 'payment already settled — no-op');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // Activating the event is the thing the host actually bought: the package
    // is what lifts the send-time guest cap.
    if (order.eventId && order.packageId) {
      await tx.event.update({
        where: { id: order.eventId },
        data: { packageId: order.packageId, status: 'ACTIVE' },
      });
    }

    // Mark the design job as paid for, inside the same transaction that marks
    // the order PAID. Outside it, a crash between the two would leave a design
    // that has been charged for and is still billable.
    const designRequestId = customDesignRequestId(order.lineItems);
    if (designRequestId) {
      await tx.customDesignRequest.updateMany({
        // billedAt: null keeps a replayed webhook from moving the timestamp.
        where: { id: designRequestId, billedAt: null },
        data: { billedAt: new Date() },
      });
    }
  });

  await audit({
    action: 'order.paid',
    actorType: 'SYSTEM',
    actorId: null,
    eventId: order.eventId,
    targetType: 'Order',
    targetId: order.id,
    meta: { orderNumber: order.orderNumber, total: order.totalHalalas },
  });

  await notifyNewOrder({
    orderNumber: order.orderNumber,
    totalHalalas: order.totalHalalas,
    currency: order.currency,
    hostName: order.user.name,
    hostPhone: order.user.phone,
    eventTitle: order.event?.title ?? null,
    packageName: order.package?.nameAr ?? null,
  });
}
