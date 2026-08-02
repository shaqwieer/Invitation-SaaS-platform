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

/** VAT as basis points, so the stored rate is an integer like every amount. */
const VAT_RATE_BPS = Math.round(0.15 * 10_000);

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
  const intent = await provider.createPayment({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountHalalas: order.totalHalalas,
    currency: order.currency,
    method,
    returnUrl: `${env().PUBLIC_WEB_URL}/checkout/${order.id}`,
    customer: { name: user.name, phone: user.phone },
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
 * Apply a settled payment.
 *
 * The single place an order becomes PAID, called by both the synchronous stub
 * and the webhook. Idempotent by design: a gateway that retries a delivery, or
 * delivers out of order, must not double-activate an event or fire the
 * new-order notification twice.
 */
export async function settlePayment(
  providerPaymentId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PENDING',
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
