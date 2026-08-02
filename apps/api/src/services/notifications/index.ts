import { formatMoney } from '@da3wa/shared';
import { logger } from '../../lib/logger.js';

/**
 * Outbound notifications for the operator, not the customer.
 *
 * "A new order came in" is the one event somebody at Da3wa wants to know about
 * immediately — it is the signal to check that the event was provisioned and
 * that the host is not stuck. Same shape as the SMS and payment services: an
 * interface plus a console implementation, so Slack, email or a webhook drops
 * in without a caller changing.
 */
export interface NewOrderNotification {
  orderNumber: string;
  totalHalalas: number;
  currency: string;
  hostName: string;
  hostPhone: string;
  eventTitle: string | null;
  packageName: string | null;
}

export interface NotificationHook {
  readonly name: string;
  onNewOrder(order: NewOrderNotification): Promise<void>;
}

export class ConsoleNotificationHook implements NotificationHook {
  readonly name = 'console';

  async onNewOrder(order: NewOrderNotification): Promise<void> {
    logger.info(
      {
        orderNumber: order.orderNumber,
        total: formatMoney(order.totalHalalas, { withCurrency: true }),
        host: order.hostName,
        event: order.eventTitle,
        package: order.packageName,
      },
      '[notify] new paid order',
    );
  }
}

let instance: NotificationHook = new ConsoleNotificationHook();

export function notifications(): NotificationHook {
  return instance;
}

export function setNotificationHook(hook: NotificationHook): void {
  instance = hook;
}

/**
 * Fire a notification without letting it affect the caller.
 *
 * A Slack outage must never turn a successful payment into a failed request —
 * the money has already moved.
 */
export async function notifyNewOrder(order: NewOrderNotification): Promise<void> {
  try {
    await instance.onNewOrder(order);
  } catch (err) {
    logger.error({ err, orderNumber: order.orderNumber }, 'new-order notification failed');
  }
}
