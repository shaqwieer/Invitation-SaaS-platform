'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  PAYMENT_METHOD_ORDER,
  formatMoney,
  type OrderView,
  type PaymentMethodValue,
} from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';
import { Logo } from '@/components/Logo';

/**
 * Checkout (§11).
 *
 * mada is listed first because it is the dominant card locally — the design
 * orders the options by actual use rather than by what a Western checkout would
 * put at the top, and a host scrolling past two irrelevant options hesitates.
 *
 * VAT is its own line, not folded into the total: the host usually forwards
 * this amount to family, and an unexplained number invites a phone call.
 */
export default function CheckoutPage() {
  const params = useParams<{ locale: string; orderId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { user, ready, authFetch } = useAuth();

  const [order, setOrder] = useState<OrderView | null>(null);
  const [missing, setMissing] = useState(false);
  const [method, setMethod] = useState<PaymentMethodValue>('MADA');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = locale === 'ar' ? 'arabic' : 'western';
  const money = (halalas: number) => formatMoney(halalas, { digits });

  useEffect(() => {
    if (ready && !user) router.replace(`/${locale}/login`);
  }, [ready, user, router, locale]);

  useEffect(() => {
    if (!user) return;
    void authFetch(`/api/orders/${params.orderId}`).then(async (res) => {
      if (!res.ok) return setMissing(true);
      setOrder((await res.json()).order);
    });
  }, [user, authFetch, params.orderId]);

  async function pay() {
    setPaying(true);
    setError(null);

    try {
      const res = await authFetch(`/api/orders/${params.orderId}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(t('checkout.failed'));
        return;
      }

      // A real gateway hosts its own page; the stub settles in place.
      if (body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }

      setOrder(body.order);
    } catch {
      setError(t('checkout.failed'));
    } finally {
      setPaying(false);
    }
  }

  if (!ready || !user || (!order && !missing)) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('auth.loading')}
      </main>
    );
  }

  if (missing || !order) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('checkout.notFound')}
      </main>
    );
  }

  if (order.status === 'PAID') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#F4F9F6] px-8 py-12 text-center">
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-emerald-700 text-[42px] font-light text-[#F7F5EF]">
          ✓
        </div>
        <h1 className="text-h2">{t('checkout.successTitle')}</h1>
        <p className="max-w-md text-body text-ink-muted">
          {t('checkout.successBody', {
            package: (locale === 'ar' ? order.package?.nameAr : order.package?.nameEn) ?? '',
          })}
        </p>

        <div className="flex flex-wrap justify-center gap-10 rounded-card border border-[#E3EDE8] bg-surface px-8 py-5">
          <Fact label={t('checkout.orderNumber')} value={order.orderNumber} latin />
          <Fact
            label={t('checkout.amount')}
            value={`${money(order.totalHalalas)} ${t('checkout.currency')}`}
          />
          {order.method && (
            <Fact label={t('checkout.paidWith')} value={t(`checkout.method.${order.method}`)} />
          )}
        </div>

        <a
          href={`/${locale}/dashboard`}
          className="mt-1 rounded-control bg-emerald-700 px-8 py-4 text-base font-semibold text-[#F7F5EF]"
        >
          {t('checkout.startSending')}
        </a>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F6F4EE] py-8">
      <div className="mx-auto flex max-w-4xl flex-col overflow-hidden rounded-card border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-8 py-5">
          <div className="flex items-center gap-2.5">
            <Logo locale={locale} size="sm" showName={false} />
            <span className="text-lg font-semibold">{t('checkout.title')}</span>
          </div>
          <span className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
            <span className="h-[7px] w-[7px] rounded-full bg-emerald-700" />
            {t('checkout.secure')}
          </span>
        </header>

        <div className="grid lg:grid-cols-[420px_1fr]">
          <aside className="flex flex-col gap-5 border-b border-line-soft bg-surface-muted p-8 lg:border-b-0 lg:border-e">
            <h2 className="text-h3">{t('checkout.summary')}</h2>

            <div className="flex flex-col gap-3.5 rounded-2xl border border-line-soft bg-surface p-5">
              {order.lineItems.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-4">
                  <span className="text-[15px] font-semibold">
                    {locale === 'ar' ? item.labelAr : item.labelEn}
                  </span>
                  <span className="shrink-0 text-[15px] font-medium">{money(item.unitPrice)}</span>
                </div>
              ))}

              <Row label={t('checkout.subtotal')} value={money(order.subtotalHalalas)} bordered />
              {order.discountHalalas > 0 && (
                <Row label={t('checkout.discount')} value={`−${money(order.discountHalalas)}`} />
              )}
              {/* Stated explicitly: the host usually forwards this to family. */}
              <Row
                label={t('checkout.vat', {
                  rate: `${displayNumber(order.vatRateBps / 100, locale)}${locale === 'ar' ? '٪' : '%'}`,
                })}
                value={money(order.vatHalalas)}
              />

              <div className="flex items-baseline justify-between border-t border-line pt-3.5">
                <span className="text-base font-semibold">{t('checkout.total')}</span>
                <span className="text-[26px] font-semibold text-emerald-700">
                  {money(order.totalHalalas)}{' '}
                  <span className="text-sm font-normal text-ink-muted">
                    {t('checkout.currency')}
                  </span>
                </span>
              </div>
            </div>

            <p className="mt-auto rounded-2xl bg-gold-light px-5 py-4 text-[13.5px] leading-loose text-gold-dark">
              {t('checkout.activationNote')}
            </p>
          </aside>

          <section className="flex flex-col gap-5 p-8">
            <h2 className="text-h3">{t('checkout.method')}</h2>

            <div className="flex flex-col gap-3">
              {PAYMENT_METHOD_ORDER.map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-3.5 rounded-2xl border p-5 ${
                    method === option
                      ? 'border-[1.5px] border-emerald-700 bg-[#F4F9F6]'
                      : 'border-line'
                  }`}
                >
                  <input
                    type="radio"
                    name="method"
                    checked={method === option}
                    onChange={() => setMethod(option)}
                    className="h-5 w-5 accent-emerald-700"
                  />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="text-[15.5px] font-semibold">
                      {t(`checkout.method.${option}`)}
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {t(`checkout.method.${option}.hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {error && (
              <p className="rounded-xl bg-status-declinedBg px-4 py-3 text-[13.5px] text-status-declinedFg">
                {error}
              </p>
            )}

            <p className="rounded-xl bg-surface-sand px-4 py-3 text-[13px] text-ink-muted">
              {t('checkout.stubNotice')}
            </p>

            <button
              onClick={pay}
              disabled={paying}
              className="mt-auto h-[58px] rounded-control bg-emerald-700 text-[16.5px] font-semibold text-[#F7F5EF] disabled:opacity-60"
            >
              {paying
                ? t('checkout.paying')
                : t('checkout.pay', { amount: money(order.totalHalalas) })}
            </button>

            <span className="text-center text-[12.5px] leading-relaxed text-ink-faint">
              {t('checkout.terms')}
            </span>
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div
      className={`flex justify-between text-sm ${bordered ? 'border-t border-[#F2F0EA] pt-3.5' : ''}`}
    >
      <span className="text-ink-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Fact({ label, value, latin }: { label: string; value: string; latin?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-[13px] text-ink-light">{label}</span>
      <span
        className={`text-[15px] font-medium ${latin ? 'font-latin' : ''}`}
        dir={latin ? 'ltr' : undefined}
      >
        {value}
      </span>
    </div>
  );
}
