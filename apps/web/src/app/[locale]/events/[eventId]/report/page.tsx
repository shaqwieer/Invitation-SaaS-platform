'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AttendanceReport } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { browserApiBase } from '@/lib/api';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';

/**
 * Post-event report (§12).
 *
 * The hero is deliberately "actual against confirmed", not a head count: it is
 * what the host plans next year's catering on, and the gap between the two —
 * the empty chairs — is the number they cannot get any other way.
 */
export default function ReportPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { user, ready, authFetch } = useAuth();

  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace(`/${locale}/login`);
  }, [ready, user, router, locale]);

  useEffect(() => {
    if (!user) return;
    void authFetch(`/api/events/${params.eventId}/report`).then(async (res) => {
      if (!res.ok) return setMissing(true);
      setReport((await res.json()).report);
    });
  }, [user, authFetch, params.eventId]);

  if (!ready || !user || (!report && !missing)) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('auth.loading')}
      </main>
    );
  }

  if (missing || !report) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('invite.notFoundTitle')}
      </main>
    );
  }

  const n = (value: number) => displayNumber(value, locale);
  const pct = (value: number | null) =>
    value === null ? '—' : `${n(Math.round(value * 100))}${locale === 'ar' ? '٪' : '%'}`;

  const time = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
          timeZone: report.event.timezone,
          hour: 'numeric',
          minute: '2-digit',
        })
      : '—';

  const peakSeats = Math.max(1, ...report.arrivals.map((a) => a.seats));
  const peak = report.arrivals.find((a) => a.isPeak);

  return (
    <main className="min-h-screen bg-[#F6F4EE]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-6 py-5 lg:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3">{t('report.title', { title: report.event.title })}</h1>
          <span className="text-[13.5px] text-ink-light">{report.event.venueName ?? ''}</span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <a
            href={`/${locale}/dashboard`}
            className="rounded-[11px] border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium"
          >
            {t('dash.viewReport')} ←
          </a>
          <a
            href={`${browserApiBase()}/api/events/${params.eventId}/exports/attendance.xlsx`}
            className="rounded-[11px] bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-[#F7F5EF]"
          >
            {t('report.exportExcel')}
          </a>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-6 lg:p-8">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_repeat(4,1fr)]">
          {/* The headline. Everything else on the page explains this number. */}
          <div className="flex flex-col gap-2.5 rounded-card bg-emerald-700 p-6">
            <span className="text-[13.5px] text-[#A9C6BA]">{t('report.actualAttendance')}</span>
            <div className="flex items-baseline gap-2.5">
              <span className="text-[44px] font-semibold leading-none text-[#FFFDF7]">
                {n(report.headline.attendedSeats)}
              </span>
              <span className="text-[15px] text-[#A9C6BA]">
                {t('report.ofConfirmedSeats', { count: n(report.headline.confirmedSeats) })}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-[rgba(255,253,247,.2)]">
              <div
                className="h-full bg-gold"
                style={{ width: `${(report.headline.complianceRate ?? 0) * 100}%` }}
              />
            </div>
            <span className="text-[13px] text-[#CFE7DB]">
              {t('report.compliance', { rate: pct(report.headline.complianceRate) })}
            </span>
          </div>

          <ReportTile
            label={t('report.invited')}
            value={n(report.counts.invited)}
            note={t('report.mainGuests')}
          />
          <ReportTile
            label={t('report.confirmed')}
            value={n(report.counts.confirmed)}
            valueClass="text-status-confirmed"
          />
          <ReportTile
            label={t('report.declined')}
            value={n(report.counts.declined)}
            valueClass="text-status-declined"
          />
          <ReportTile
            label={t('report.noShow')}
            value={n(report.counts.confirmedNoShow)}
            valueClass="text-status-pending"
            note={`${n(report.counts.noShowSeats)} ${t('report.emptySeats')}`}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <section className="flex flex-col gap-5 rounded-card border border-line-soft bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-h3">{t('report.arrivals')}</h2>
              {peak && (
                <span className="text-[13px] text-ink-light">
                  {t('report.peak', { time: time(peak.at) })}
                </span>
              )}
            </div>

            {report.arrivals.length === 0 ? (
              <p className="py-8 text-center text-body text-ink-muted">{t('report.nobodyCame')}</p>
            ) : (
              // Bars are laid out LTR regardless of page direction: a time axis
              // reads left-to-right in both languages.
              <div dir="ltr" className="flex h-[200px] items-end gap-3 overflow-x-auto pt-2">
                {report.arrivals.map((bucket) => (
                  <div
                    key={bucket.at}
                    className="flex min-w-[44px] flex-1 flex-col items-center gap-2"
                  >
                    <span
                      className={`text-[12px] ${bucket.isPeak ? 'font-semibold text-emerald-700' : 'text-ink-light'}`}
                    >
                      {n(bucket.seats)}
                    </span>
                    <div
                      className={`w-full rounded-t-md ${bucket.isPeak ? 'bg-emerald-700' : 'bg-[#8FBFAB]'}`}
                      style={{ height: `${Math.max(4, (bucket.seats / peakSeats) * 100)}%` }}
                    />
                    <span
                      className={`font-latin text-[11.5px] ${bucket.isPeak ? 'font-medium text-emerald-700' : 'text-ink-faint'}`}
                    >
                      {time(bucket.at)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-8 border-t border-line-soft pt-4">
              <SubStat label={t('report.firstEntry')} value={time(report.timings.firstEntry)} />
              <SubStat label={t('report.lastEntry')} value={time(report.timings.lastEntry)} />
              <SubStat
                label={t('report.medianGap')}
                value={
                  report.timings.medianScanGapSeconds === null
                    ? '—'
                    : t('report.seconds', {
                        count: n(Math.round(report.timings.medianScanGapSeconds)),
                      })
                }
              />
            </div>
          </section>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface p-6">
              <h2 className="text-h3">{t('report.byGroup')}</h2>
              <div className="flex flex-col gap-3.5">
                {report.byGroup.map((group) => (
                  <div key={group.group} className="flex flex-col gap-2">
                    <div className="flex justify-between text-[13.5px]">
                      <span>{group.group}</span>
                      <span className="text-ink-muted">
                        {n(group.attendedSeats)} / {n(group.confirmedSeats)}
                      </span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded bg-line-soft">
                      <div
                        className={
                          group.rate >= 0.9 ? 'h-full bg-emerald-700' : 'h-full bg-[#5C9C83]'
                        }
                        style={{ width: `${group.rate * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-1 flex-col gap-3.5 rounded-card border border-line-soft bg-surface p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-h3">{t('report.noShowList')}</h2>
                <span className="text-[13px] text-ink-light">
                  ({n(report.counts.confirmedNoShow)})
                </span>
              </div>

              <div className="flex flex-col">
                {report.noShows.slice(0, 8).map((row) => (
                  <div
                    key={row.guestId}
                    className="flex items-center justify-between border-b border-[#F2F0EA] py-2.5 last:border-0"
                  >
                    <span className="text-[14.5px]">{row.name}</span>
                    <span className="text-[13px] text-ink-light">
                      {t('report.seats', { count: n(row.seats) })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function ReportTile({
  label,
  value,
  note,
  valueClass = '',
}: {
  label: string;
  value: string;
  note?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line-soft bg-surface-muted p-5">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className={`text-[30px] font-semibold leading-none ${valueClass}`}>{value}</span>
      {note && <span className="text-[12.5px] text-ink-faint">{note}</span>}
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-ink-light">{label}</span>
      <span className="text-[17px] font-semibold">{value}</span>
    </div>
  );
}
