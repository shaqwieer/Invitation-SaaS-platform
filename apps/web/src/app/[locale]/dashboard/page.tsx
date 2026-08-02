'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ActivityEntry, DashboardSummary } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { browserApiBase } from '@/lib/api';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber, formatEventDate } from '@/lib/format';

/** How often the dashboard re-reads itself. */
const POLL_MS = 30_000;

interface EventOption {
  id: string;
  title: string;
  startsAt: string;
}

interface GuestInviteLink {
  guestId: string;
  guestName: string;
  whatsappUrl: string;
}

/** «صباح الخير» before noon — a host checking replies at 10am is not in the evening. */
function greetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'dash.greetingMorning';
  if (hour < 17) return 'dash.greetingAfternoon';
  return 'dash.greetingEvening';
}

/**
 * Host dashboard (§03).
 *
 * Requirement 7's "real-time status refresh" is a poll, not a socket: guests
 * answer over hours, not milliseconds, and a 30-second poll that survives a
 * flaky venue connection is worth more here than a live channel that silently
 * disconnects and leaves the host reading stale numbers.
 */
export default function DashboardPage() {
  const params = useParams<{ locale: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { user, ready, logout, authFetch } = useAuth();

  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(Date.now());
  const [sendLinks, setSendLinks] = useState<GuestInviteLink[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace(`/${locale}/login`);
  }, [ready, user, router, locale]);

  useEffect(() => {
    if (!user) return;
    void authFetch('/api/events')
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((body) => {
        setEvents(body.events);
        setEventId((current) => current ?? body.events[0]?.id ?? null);
      });
  }, [user, authFetch]);

  const load = useCallback(async () => {
    if (!eventId) return;
    const res = await authFetch(`/api/events/${eventId}/dashboard`);
    if (!res.ok) return;
    const body = await res.json();
    setSummary(body.summary);
    setFetchedAt(Date.now());
  }, [eventId, authFetch]);

  useEffect(() => {
    if (!eventId) return;
    void load();

    const timer = setInterval(() => void load(), POLL_MS);
    // Coming back to the tab should feel instant rather than waiting out the
    // remainder of the interval.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [eventId, load]);

  /**
   * «أرسلها الآن» — prepare every unsent invitation.
   *
   * Deliberately does *not* fire N `window.open` calls: browsers block all but
   * the first, so the host would tap once, see one chat, and quietly send one
   * invitation out of thirty. Instead the links are listed and the host taps
   * through them — which is also what the design warns about
   * («سيفتح واتساب ٣٠ مرة متتالية»).
   */
  const sendUnsent = useCallback(async () => {
    if (!eventId || !summary) return;
    if (!window.confirm(t('dash.sendConfirm', { count: summary.counts.NOT_SENT }))) return;

    setSending(true);
    setSendError(null);

    try {
      const res = await authFetch(`/api/events/${eventId}/guests/bulk-send`, {
        method: 'POST',
        body: JSON.stringify({ onlyUnsent: true }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setSendError(
          body?.error?.code === 'GUEST_QUOTA_EXCEEDED'
            ? t('dash.quotaBlocked')
            : t('dash.sendFailed'),
        );
        return;
      }

      setSendLinks(body.links);
      // The server has already marked them SENT, so the tiles are now stale.
      await load();
    } catch {
      setSendError(t('dash.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [eventId, summary, authFetch, load, t]);

  if (!ready || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('auth.loading')}
      </main>
    );
  }

  if (events !== null && events.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="text-h2">{t('dash.noEvents')}</h1>
        <p className="max-w-sm text-body text-ink-muted">{t('dash.noEventsBody')}</p>
      </main>
    );
  }

  const minutesAgo = Math.floor((Date.now() - fetchedAt) / 60_000);

  return (
    <main className="min-h-screen bg-[#F6F4EE]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4 lg:px-8">
        <div className="flex flex-col gap-1">
          <span className="text-xl font-semibold">{t(greetingKey(), { name: user.name })}</span>
          <span className="text-[13.5px] text-ink-light">
            {t('dash.updated', {
              ago:
                minutesAgo < 1
                  ? t('dash.justNow')
                  : t('dash.minutesAgo', { count: displayNumber(minutesAgo, locale) }),
            })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {events && events.length > 1 && (
            <select
              value={eventId ?? ''}
              onChange={(e) => setEventId(e.target.value)}
              className="rounded-[11px] border border-line-strong bg-surface px-3 py-2.5 text-sm"
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          )}

          <a
            href={`/${locale === 'ar' ? 'en' : 'ar'}/dashboard`}
            className="rounded-[9px] border border-line px-2.5 py-2 font-latin text-[13px] text-ink-light"
          >
            {locale === 'ar' ? 'EN' : 'ع'}
          </a>

          <button
            onClick={() => void logout().then(() => router.replace(`/${locale}/login`))}
            className="rounded-[11px] border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium"
          >
            {t('auth.logout')}
          </button>
        </div>
      </header>

      {!summary ? (
        <div className="p-8 text-body text-ink-muted">{t('auth.loading')}</div>
      ) : (
        <div className="flex flex-col gap-5 p-6 lg:p-8">
          {sendError && (
            <p className="rounded-card bg-status-declinedBg px-5 py-4 text-sm text-status-declinedFg">
              {sendError}
            </p>
          )}

          <StatTiles
            summary={summary}
            locale={locale}
            t={t}
            sending={sending}
            onSendUnsent={sendUnsent}
          />

          <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
            <Completion summary={summary} locale={locale} t={t} eventId={eventId!} />
            <Activity entries={summary.activity} locale={locale} t={t} />
          </div>
        </div>
      )}

      {sendLinks && <SendPanel links={sendLinks} t={t} onClose={() => setSendLinks(null)} />}
    </main>
  );
}

type T = ReturnType<typeof translator>;

function StatTiles({
  summary,
  locale,
  t,
  sending,
  onSendUnsent,
}: {
  summary: DashboardSummary;
  locale: AppLocale;
  t: T;
  sending: boolean;
  onSendUnsent: () => void;
}) {
  const n = (value: number) => displayNumber(value, locale);
  const { counts } = summary;

  /** Percent sign follows the locale, like every other rate on this page. */
  const pct = (value: number) => `${n(Math.round(value * 100))}${locale === 'ar' ? '٪' : '%'}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label={t('dash.totalInvited')} value={n(counts.total)}>
        <span className="text-[12.5px] text-ink-faint">
          {t('dash.potentialSeats', { count: n(summary.seats.potential) })}
        </span>
      </Tile>

      <Tile
        label={t('status.CONFIRMED')}
        value={n(counts.CONFIRMED + counts.ATTENDED)}
        dot="bg-status-confirmed"
        valueClass="text-status-confirmed"
        border="border-[#CFE3D9]"
      >
        <span className="text-[12.5px] text-ink-muted">
          {t('dash.confirmedSeats')}: {n(summary.seats.confirmed)}
        </span>
      </Tile>

      <Tile
        label={t('status.DECLINED')}
        value={n(counts.DECLINED)}
        dot="bg-status-declined"
        valueClass="text-status-declined"
      >
        <span className="text-[12.5px] text-ink-faint">
          {t('dash.declinedShare', {
            pct: pct(counts.DECLINED / Math.max(1, counts.total)),
          })}
        </span>
      </Tile>

      <Tile
        label={t('status.SENT')}
        value={n(counts.SENT + counts.OPENED)}
        dot="bg-status-pending"
        valueClass="text-status-pending"
      >
        {summary.awaitingReply.oldestSentDaysAgo !== null && (
          <span className="text-[12.5px] text-ink-faint">
            {t('dash.reminderNudge', {
              count: n(summary.awaitingReply.count),
              days: n(summary.awaitingReply.oldestSentDaysAgo),
            })}
          </span>
        )}
      </Tile>

      {/* The only tile that carries an action: "not sent" is the one number
          that depends on the host, and it is why they opened the dashboard. */}
      <div className="flex flex-col gap-3 rounded-card border border-emerald-700 bg-emerald-700 p-5">
        <span className="text-[13.5px] text-[#A9C6BA]">{t('dash.notSentYet')}</span>
        <span className="text-[34px] font-semibold leading-none text-[#FFFDF7]">
          {n(counts.NOT_SENT)}
        </span>
        {counts.NOT_SENT > 0 && (
          <button
            onClick={onSendUnsent}
            disabled={sending}
            className="rounded-[9px] bg-[#FFFDF7] py-2.5 text-[13px] font-semibold text-emerald-800 disabled:opacity-60"
          >
            {sending ? t('dash.sendPreparing') : t('dash.sendNow')}
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  children,
  dot,
  valueClass = 'text-ink',
  border = 'border-line-soft',
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  dot?: string;
  valueClass?: string;
  border?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-card border ${border} bg-surface p-5`}>
      <span className="inline-flex items-center gap-2 text-[13.5px] text-ink-muted">
        {dot && <span className={`h-[7px] w-[7px] rounded-full ${dot}`} />}
        {label}
      </span>
      <span className={`text-[34px] font-semibold leading-none ${valueClass}`}>{value}</span>
      {children}
    </div>
  );
}

function Completion({
  summary,
  locale,
  t,
  eventId,
}: {
  summary: DashboardSummary;
  locale: AppLocale;
  t: T;
  eventId: string;
}) {
  const n = (value: number) => displayNumber(value, locale);
  const { counts } = summary;
  const total = Math.max(1, counts.total);

  const segments = [
    {
      key: 'confirmed',
      width: ((counts.CONFIRMED + counts.ATTENDED) / total) * 100,
      colour: 'bg-status-confirmed',
      label: t('status.CONFIRMED'),
      count: counts.CONFIRMED + counts.ATTENDED,
      swatch: 'bg-status-confirmed',
    },
    {
      key: 'declined',
      width: (counts.DECLINED / total) * 100,
      colour: 'bg-[#D9BEBB]',
      label: t('status.DECLINED'),
      count: counts.DECLINED,
      swatch: 'bg-[#D9BEBB]',
    },
    {
      key: 'pending',
      width: ((counts.SENT + counts.OPENED) / total) * 100,
      colour: 'bg-[#EBD7A8]',
      label: t('status.SENT'),
      count: counts.SENT + counts.OPENED,
      swatch: 'bg-[#EBD7A8]',
    },
    {
      key: 'notSent',
      width: (counts.NOT_SENT / total) * 100,
      colour: 'bg-[#DCDAD2]',
      label: t('status.NOT_SENT'),
      count: counts.NOT_SENT,
      swatch: 'bg-[#DCDAD2]',
    },
  ];

  const date = formatEventDate(summary.event.startsAt, summary.event.timezone, locale);

  return (
    <section className="flex flex-col gap-5 rounded-card border border-line-soft bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3">{t('dash.completion')}</h2>
        <span className="text-[13px] text-ink-light">
          {summary.event.title} · {date.gregorian}
        </span>
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[42px] font-semibold leading-none">
            {displayNumber(Math.round(summary.rates.confirmation * 100), locale)}
            {locale === 'ar' ? '٪' : '%'}
          </span>
          <span className="text-[14.5px] text-ink-muted">{t('dash.confirmedOfInvited')}</span>
        </div>

        <div className="flex h-4 overflow-hidden rounded-lg bg-line-soft">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={segment.colour}
              style={{ width: `${segment.width}%` }}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-5">
          {segments.map((segment) => (
            <span
              key={segment.key}
              className="inline-flex items-center gap-2 text-[13px] text-ink-muted"
            >
              <span className={`h-2.5 w-2.5 rounded-[3px] ${segment.swatch}`} />
              {segment.label} {n(segment.count)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-line-soft pt-5 sm:grid-cols-3">
        <SubStat label={t('dash.confirmedSeats')} value={n(summary.seats.confirmed)} />
        <SubStat
          label={t('dash.avgCompanions')}
          value={displayNumber(
            Math.round(summary.averages.companionsPerConfirmedGuest * 10) / 10,
            locale,
          )}
        />
        <SubStat
          label={t('dash.avgResponse')}
          value={
            summary.averages.responseHours === null
              ? '—'
              : t('dash.hours', {
                  count: displayNumber(Math.round(summary.averages.responseHours), locale),
                })
          }
        />
      </div>

      {summary.rates.attendance !== null && (
        <div className="flex items-center justify-between rounded-2xl bg-emerald-100 px-4 py-3.5">
          <span className="text-sm text-status-confirmedFg">{t('dash.attendanceRate')}</span>
          <span className="text-lg font-semibold text-status-confirmedFg">
            {displayNumber(Math.round(summary.rates.attendance * 100), locale)}
            {locale === 'ar' ? '٪' : '%'}
          </span>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2.5 border-t border-line-soft pt-5">
        {summary.quota.cap !== null && (
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[12.5px] text-ink-light">
              {t('dash.quotaUsed', {
                used: n(summary.quota.used),
                cap: n(summary.quota.cap),
              })}
            </span>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft">
              <div
                className={summary.quota.exceeded ? 'h-full bg-status-declined' : 'h-full bg-gold'}
                style={{
                  width: `${Math.min(100, (summary.quota.used / summary.quota.cap) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        <a
          href={`${browserApiBase()}/api/events/${eventId}/exports/guests.xlsx`}
          className="rounded-[11px] border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium"
        >
          {t('dash.exportGuests')}
        </a>
        <a
          href={`/${locale}/events/${eventId}/report`}
          className="rounded-[11px] bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-[#F7F5EF]"
        >
          {t('dash.viewReport')}
        </a>
      </div>
    </section>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-ink-light">{label}</span>
      <span className="text-[22px] font-semibold">{value}</span>
    </div>
  );
}

/**
 * The prepared invitations, one tappable link each.
 *
 * The host taps through the list rather than the app firing thirty popups:
 * browsers block every `window.open` after the first, so an automatic burst
 * would send one invitation and silently drop the rest.
 */
function SendPanel({ links, t, onClose }: { links: GuestInviteLink[]; t: T; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-card bg-surface sm:rounded-card">
        <div className="flex flex-col gap-2 border-b border-line-soft p-6">
          <h2 className="text-h3">{t('dash.sendTitle')}</h2>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">{t('dash.sendBody')}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {links.map((link) => (
            <div
              key={link.guestId}
              className="flex items-center justify-between gap-3 border-b border-[#F2F0EA] px-6 py-3.5"
            >
              <span className="text-[14.5px]">{link.guestName}</span>
              <a
                href={link.whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 rounded-[9px] bg-emerald-700 px-4 py-2 text-[13px] font-semibold text-[#F7F5EF]"
              >
                {t('dash.sendOne')}
              </a>
            </div>
          ))}
        </div>

        <div className="border-t border-line-soft p-5">
          <button
            onClick={onClose}
            className="w-full rounded-control border border-line-strong bg-surface py-3 text-sm font-medium"
          >
            {t('dash.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_DOT: Record<string, string> = {
  CONFIRMED: 'bg-status-confirmed',
  DECLINED: 'bg-status-declined',
  CHECKED_IN: 'bg-gold',
  INVITES_SENT: 'bg-status-notSent',
  GUESTS_IMPORTED: 'bg-gold',
};

function Activity({ entries, locale, t }: { entries: ActivityEntry[]; locale: AppLocale; t: T }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface p-6">
      <h2 className="text-h3">{t('dash.activity')}</h2>

      {entries.length === 0 ? (
        <p className="text-body text-ink-muted">{t('dash.noActivity')}</p>
      ) : (
        <div className="flex flex-col">
          {entries.map((entry, index) => {
            const key =
              entry.kind === 'CONFIRMED' && entry.count
                ? 'activity.CONFIRMED_WITH'
                : `activity.${entry.kind}`;

            return (
              <div
                key={`${entry.at}-${index}`}
                className="flex gap-3 border-b border-[#F2F0EA] py-3.5 last:border-0"
              >
                <span
                  className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${ACTIVITY_DOT[entry.kind]}`}
                />
                <div className="flex flex-col gap-1">
                  <span className="text-[14.5px] leading-relaxed">
                    {t(key, {
                      name: entry.guestName ?? '',
                      count: displayNumber(entry.count ?? 0, locale),
                    })}
                  </span>
                  <span className="text-[12.5px] text-ink-faint">
                    {new Date(entry.at).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
