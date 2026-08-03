'use client';

/**
 * Order history.
 *
 * A pending order is the only row here that is also an errand, so it carries
 * the action that finishes it rather than leaving the host to remember where
 * checkout lives.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatMoney, type OrderView } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import {
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Spinner,
  TableFrame,
  Td,
  Th,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';

const STATUS_CLASS: Record<string, string> = {
  PAID: 'bg-status-confirmedBg text-status-confirmedFg',
  PENDING: 'bg-status-pendingBg text-status-pendingFg',
  CANCELLED: 'bg-status-notSentBg text-status-notSentFg',
  REFUNDED: 'bg-status-notSentBg text-status-notSentFg',
  FAILED: 'bg-status-declinedBg text-status-declinedFg',
};

export default function OrdersPage() {
  const params = useParams<{ locale: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const { authFetch } = useAuth();

  const [orders, setOrders] = useState<OrderView[] | null>(null);

  useEffect(() => {
    void authFetch('/api/orders')
      .then((res) => (res.ok ? res.json() : { orders: [] }))
      .then((body) => setOrders(body.orders ?? []))
      .catch(() => setOrders([]));
  }, [authFetch]);

  const money = (halalas: number) =>
    `${formatMoney(halalas, { digits: locale === 'ar' ? 'arabic' : 'western' })} ${t('checkout.currency')}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('orders.title')} subtitle={t('orders.body')} />

      <Card>
        {!orders ? (
          <Spinner label={t('common.loading')} />
        ) : orders.length === 0 ? (
          <EmptyState title={t('orders.empty')} body={t('orders.emptyBody')} />
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <Th>{t('orders.number')}</Th>
                <Th>{t('orders.event')}</Th>
                <Th>{t('orders.package')}</Th>
                <Th>{t('orders.amount')}</Th>
                <Th>{t('orders.statusCol')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <span dir="ltr" className="font-latin text-[13.5px] font-medium">
                      {order.orderNumber}
                    </span>
                  </Td>
                  <Td className="text-ink-muted">{order.event?.title ?? t('common.none')}</Td>
                  <Td className="text-ink-muted">
                    {(locale === 'ar' ? order.package?.nameAr : order.package?.nameEn) ??
                      t('common.none')}
                  </Td>
                  <Td className="font-medium">{money(order.totalHalalas)}</Td>
                  <Td>
                    <span
                      className={`whitespace-nowrap rounded-chip px-3 py-1.5 text-caption font-medium ${
                        STATUS_CLASS[order.status] ?? STATUS_CLASS.CANCELLED
                      }`}
                    >
                      {t(`orders.status.${order.status}`)}
                    </span>
                  </Td>
                  <Td className="text-end">
                    {order.status === 'PENDING' && (
                      <LinkButton
                        size="sm"
                        variant="primary"
                        href={`/${locale}/checkout/${order.id}`}
                      >
                        {t('orders.pay')}
                      </LinkButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
    </div>
  );
}
