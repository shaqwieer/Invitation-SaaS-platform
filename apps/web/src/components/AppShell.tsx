'use client';

/**
 * The host application frame (§03 of the design doc).
 *
 * Until now the dashboard was an island: it rendered its own header and there
 * was no way to reach any other host screen. The design's sidebar is what makes
 * the product navigable, so it lives here and every host page inherits it.
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useEvents } from './EventContext';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber, formatEventDate } from '@/lib/format';
import { EmptyState, LinkButton, Spinner } from './ui';
import { Logo } from './Logo';

/** «صباح الخير» before noon — a host checking replies at 10am is not in the evening. */
function greetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'dash.greetingMorning';
  if (hour < 17) return 'dash.greetingAfternoon';
  return 'dash.greetingEvening';
}

/** Days until the event — the sidebar's «بعد ١٤ يومًا». */
function daysUntil(startsAt: string): number {
  const diff = new Date(startsAt).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, logout } = useAuth();
  const { events, current, quota, eventMissing, selectEvent } = useEvents();

  const segments = pathname.split('/').filter(Boolean);
  const locale: AppLocale = isLocale(segments[0] ?? '') ? (segments[0] as AppLocale) : DEFAULT_LOCALE;
  const t = translator(locale);

  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) return router.replace(`/${locale}/login`);
    // An admin has no events of their own, so every screen in this shell would
    // be empty or disabled for them. Their home is the operator panel.
    if (user.role === 'ADMIN') router.replace(`/${locale}/admin`);
  }, [ready, user, router, locale]);

  // A route change on a phone should close the drawer; leaving it open covers
  // the page the host just navigated to.
  useEffect(() => setNavOpen(false), [pathname]);

  // Admins are covered too: the redirect above is in flight, and rendering the
  // host shell in the meantime would flash a sidebar they should never see.
  if (!ready || !user || user.role === 'ADMIN') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner label={t('auth.loading')} />
      </main>
    );
  }

  const eventId = current?.id;
  const base = `/${locale}`;

  const items: Array<{ href: string; label: string; enabled: boolean }> = [
    { href: `${base}/dashboard`, label: t('nav.home'), enabled: true },
    { href: `${base}/events/${eventId}/guests`, label: t('nav.guests'), enabled: !!eventId },
    { href: `${base}/events/${eventId}/card`, label: t('nav.card'), enabled: !!eventId },
    { href: `${base}/events/${eventId}/scanners`, label: t('nav.scanner'), enabled: !!eventId },
    { href: `${base}/events/${eventId}/report`, label: t('nav.report'), enabled: !!eventId },
    { href: `${base}/events/${eventId}/settings`, label: t('nav.settings'), enabled: !!eventId },
    // Not per-event: a host's receipts span every wedding they have run.
    { href: `${base}/orders`, label: t('orders.title'), enabled: true },
  ];

  const date = current ? formatEventDate(current.startsAt, current.timezone, locale) : null;
  const remaining = current ? daysUntil(current.startsAt) : 0;

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-emerald-900 p-5 text-[#DCE7E1]">
      <Logo
        locale={locale}
        href={`${base}/dashboard`}
        nameClassName="text-lg font-semibold text-[#FFFDF7]"
      />

      {current && date && (
        <div className="flex flex-col gap-1.5 rounded-card bg-emerald-800/70 p-4">
          <span className="text-[11.5px] tracking-wide text-[#8FA69B]">{t('nav.currentEvent')}</span>
          <span className="text-[15px] font-semibold leading-snug text-[#FFFDF7]">
            {current.title}
          </span>
          <span className="text-[12.5px] text-[#A9C6BA]">
            {date.gregorian}
            {remaining > 0 && ` · ${t('nav.inDays', { count: displayNumber(remaining, locale) })}`}
          </span>

          {events && events.length > 1 && (
            <select
              value={current.id}
              onChange={(e) => {
                selectEvent(e.target.value);
                router.push(`${base}/dashboard`);
              }}
              className="mt-2 rounded-[9px] border border-emerald-700 bg-emerald-900 px-2.5 py-2 text-[13px] text-[#DCE7E1] outline-none focus:border-gold"
              aria-label={t('nav.switchEvent')}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) =>
          item.enabled ? (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
              className={`rounded-[11px] px-3.5 py-3 text-[14.5px] transition-colors ${
                pathname === item.href
                  ? 'bg-emerald-700 font-medium text-[#FFFDF7]'
                  : 'text-[#8FA69B] hover:bg-emerald-800 hover:text-[#DCE7E1]'
              }`}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.href}
              aria-disabled
              className="cursor-not-allowed rounded-[11px] px-3.5 py-3 text-[14.5px] text-[#5B7A6E]"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>

      {quota?.cap != null && (
        <div className="flex flex-col gap-2 border-t border-emerald-800 pt-4">
          <span className="text-[12.5px] text-[#A9C6BA]">
            {quota.packageName} · {t('nav.guestCap', { count: displayNumber(quota.cap, locale) })}
          </span>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-emerald-800">
            <div
              className={quota.exceeded ? 'h-full bg-status-declined' : 'h-full bg-gold'}
              style={{ width: `${Math.min(100, (quota.used / quota.cap) * 100)}%` }}
            />
          </div>
          <span className="text-[11.5px] text-[#8FA69B]">
            {t('dash.quotaUsed', {
              used: displayNumber(quota.used, locale),
              cap: displayNumber(quota.cap, locale),
            })}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F4EE] lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onMouseDown={() => setNavOpen(false)}
        >
          <div
            className="h-full w-[264px] max-w-[82vw]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNavOpen(true)}
              aria-label={t('nav.openMenu')}
              className="rounded-[9px] border border-line-strong px-3 py-2 text-sm lg:hidden"
            >
              ☰
            </button>
            <div className="flex flex-col">
              <span className="text-[15.5px] font-semibold">
                {t(greetingKey(), { name: user.name })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={`/${locale === 'ar' ? 'en' : 'ar'}${pathname.slice(base.length)}`}
              className="rounded-[9px] border border-line px-2.5 py-2 font-latin text-[13px] text-ink-light"
            >
              {locale === 'ar' ? 'EN' : 'ع'}
            </a>
            <button
              onClick={() => void logout().then(() => router.replace(`${base}/login`))}
              className="rounded-[11px] border border-line-strong bg-surface px-4 py-2 text-sm font-medium"
            >
              {t('auth.logout')}
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-5 lg:p-8">
          {/* A URL naming an event this account cannot see gets one clear
              answer, rather than another host's event in the sidebar and a
              failed fetch underneath. Same wording whether the event belongs to
              someone else or does not exist: which of the two it is, is not
              this account's business. */}
          {eventMissing ? (
            <EmptyState
              title={t('event.notFound')}
              body={t('event.notFoundBody')}
              action={
                <LinkButton variant="primary" href={`${base}/dashboard`}>
                  {t('nav.home')}
                </LinkButton>
              }
            />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
