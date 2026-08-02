'use client';

import { useState } from 'react';
import type { PublicInvitation } from '@da3wa/shared';
import { browserApiBase } from '@/lib/api';
import { direction, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber, formatEventDate, mapsUrl } from '@/lib/format';

/**
 * The three guest-facing states from §07–09, in one component.
 *
 * A client component because the whole screen is one short interaction — pick a
 * companion count, answer, see the QR — and bouncing to the server between
 * those steps inside WhatsApp's in-app browser is exactly where a guest gives
 * up. The *data* is still server-fetched and passed in, so the first paint is
 * complete and correct with no JavaScript.
 */
export function InviteScreen({
  invitation,
  locale,
  token,
}: {
  invitation: PublicInvitation;
  locale: AppLocale;
  token: string;
}) {
  const [state, setState] = useState(invitation);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Lets a guest reopen the form to change an answer they already gave. */
  const [editing, setEditing] = useState(false);

  const t = translator(locale);
  const { guest, event } = state;
  const dir = direction(locale);

  const [companions, setCompanions] = useState(guest.companionsConfirmed);
  const date = formatEventDate(event.startsAt, event.timezone, locale);
  const hosts = [event.hostName, event.partnerName]
    .filter(Boolean)
    .join(locale === 'ar' ? ' و' : ' & ');

  const answered = guest.status === 'CONFIRMED' || guest.status === 'DECLINED';
  const showForm = !answered || editing;

  async function submit(attending: boolean) {
    setPending(true);
    setError(null);

    try {
      const res = await fetch(`${browserApiBase()}/api/invite/${token}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attending, companions: attending ? companions : 0 }),
      });

      const body = await res.json();

      if (!res.ok) {
        // The API carries an Arabic message for exactly this surface.
        setError(body?.error?.details?.messageAr ?? body?.error?.message ?? t('invite.errorTitle'));
        return;
      }

      setState(body.invitation);
      setQrToken(body.qrToken);
      setEditing(false);
    } catch {
      setError(t('invite.errorTitle'));
    } finally {
      setPending(false);
    }
  }

  const seats = companions + 1;
  const maps = mapsUrl(event);
  const blocked = !state.canRespond.allowed && !answered;

  return (
    <main dir={dir} lang={locale} className="flex min-h-screen flex-col bg-[#FAF8F3]">
      <header className="flex items-center justify-between border-b border-[#E2DFD6] bg-line-soft px-4 py-2.5">
        <span className="w-6" />
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-latin text-[12.5px] font-medium text-[#3D4741]">da3wa.sa</span>
          <span className="text-[10.5px] text-[#9AA49E]">{t('invite.personalInvitation')}</span>
        </div>
        <a
          href={`?lang=${locale === 'ar' ? 'en' : 'ar'}`}
          className="font-latin text-[11px] text-ink-light underline"
        >
          {locale === 'ar' ? 'EN' : 'ع'}
        </a>
      </header>

      {guest.status === 'CONFIRMED' && !editing ? (
        <ConfirmedState
          state={state}
          qrToken={qrToken}
          token={token}
          locale={locale}
          date={date}
          maps={maps}
          onEdit={() => setEditing(true)}
        />
      ) : guest.status === 'DECLINED' && !editing ? (
        <DeclinedState locale={locale} onReconsider={() => setEditing(true)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-2 pt-4">
            <InvitationCard
              locale={locale}
              hosts={hosts}
              title={event.title}
              guestName={guest.name}
              cardColor={event.cardColor}
            />

            <section className="overflow-hidden rounded-[18px] border border-line-soft bg-surface">
              <Row label={t('invite.date')}>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[14.5px] font-medium">
                    {date.weekday} {date.gregorian}
                  </span>
                  <span className="text-xs text-gold">{date.hijri}</span>
                </div>
              </Row>
              <Row label={t('invite.time')}>
                <span className="text-[14.5px] font-medium">{date.time}</span>
              </Row>
              {(event.venueName || maps) && (
                <Row label={t('invite.venue')} align="start" last>
                  <div className="flex flex-col items-end gap-2.5">
                    <span className="text-end text-[14.5px] font-medium leading-relaxed">
                      {event.venueName}
                      {event.venueAddress && (
                        <>
                          <br />
                          <span className="text-[13px] font-normal text-ink-light">
                            {event.venueAddress}
                          </span>
                        </>
                      )}
                    </span>
                    {maps && (
                      <a
                        href={maps}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-2 rounded-[11px] bg-emerald-100 px-4 py-2.5 text-[13.5px] font-semibold text-status-confirmedFg"
                      >
                        <span className="h-[7px] w-[7px] rounded-full bg-emerald-700" />
                        {t('invite.openInMaps')}
                      </a>
                    )}
                  </div>
                </Row>
              )}
            </section>

            {showForm && guest.companionsAllowed > 0 && (
              <section className="flex flex-col gap-2.5 rounded-[18px] border border-line-soft bg-surface p-3.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px] font-medium">{t('invite.companionsQuestion')}</span>
                  <span className="text-xs text-ink-faint">
                    {t('invite.companionsMax', {
                      count: displayNumber(guest.companionsAllowed, locale),
                    })}
                  </span>
                </div>

                {/* The count is chosen *before* the confirm button: in Gulf
                    families the real answer is "how many", and deferring it to a
                    second screen loses accuracy. */}
                <div className="flex gap-2.5">
                  {Array.from({ length: guest.companionsAllowed + 1 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCompanions(n)}
                      aria-pressed={companions === n}
                      className={`h-[50px] flex-1 rounded-[14px] border-[1.5px] text-[19px] font-semibold transition-colors ${
                        companions === n
                          ? 'border-emerald-700 bg-emerald-700 text-surface-sand'
                          : 'border-line-strong bg-surface text-ink-muted'
                      }`}
                    >
                      {displayNumber(n, locale)}
                    </button>
                  ))}
                </div>

                <span className="text-[13px] leading-relaxed text-ink-muted">
                  {t('invite.seatsNote', { seats: displayNumber(seats, locale) })}
                </span>
              </section>
            )}
          </div>

          {/* Pinned to the bottom: the page opens inside WhatsApp's browser,
              where the scroll affordance is barely visible. */}
          <div className="flex flex-col gap-2.5 border-t border-line-soft bg-[#FAF8F3] px-5 pb-5 pt-3">
            {error && (
              <p className="rounded-xl bg-status-declinedBg px-4 py-2.5 text-center text-[13px] text-status-declinedFg">
                {error}
              </p>
            )}

            {blocked ? (
              <p className="rounded-xl bg-surface-sand px-4 py-3 text-center text-[13.5px] text-ink-muted">
                {locale === 'ar' ? state.canRespond.messageAr : state.canRespond.messageEn}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(true)}
                  className="h-[54px] rounded-[15px] bg-emerald-700 text-[17px] font-semibold text-[#F7F5EF] shadow-[0_12px_24px_-16px_rgba(9,49,39,.9)] disabled:opacity-60"
                >
                  {pending ? t('invite.submitting') : t('invite.accept')}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(false)}
                  className="h-12 rounded-[15px] border border-line-strong bg-surface text-base font-medium text-ink-muted disabled:opacity-60"
                >
                  {t('invite.decline')}
                </button>
              </>
            )}

            <span className="text-center text-xs leading-relaxed text-ink-faint">
              {t('invite.changeableNote')}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

function Row({
  label,
  children,
  align = 'center',
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  align?: 'center' | 'start';
  last?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 px-4 py-3 ${
        align === 'start' ? 'items-start' : 'items-center'
      } ${last ? '' : 'border-b border-[#F2F0EA]'}`}
    >
      <span className="text-[13.5px] text-ink-light">{label}</span>
      {children}
    </div>
  );
}

function InvitationCard({
  locale,
  hosts,
  title,
  guestName,
  cardColor,
}: {
  locale: AppLocale;
  hosts: string;
  title: string;
  guestName: string;
  cardColor: string;
}) {
  const t = translator(locale);

  return (
    <section className="flex flex-none flex-col items-center gap-2.5 rounded-[22px] border border-[#EDE8DA] bg-surface px-5 py-3.5 shadow-[0_14px_34px_-26px_rgba(23,33,29,.7)]">
      <span className="text-[11.5px] text-ink-faint">{t('invite.bismillah')}</span>
      <div className="h-px w-12 bg-[#D9CFAE]" />
      <span className="text-center text-[13.5px] leading-loose text-ink-muted">
        {t('invite.hostsInvite', { hosts })}
      </span>
      {/* Amiri is reserved for the occasion's name — never for UI chrome. */}
      <span
        className="text-center font-serif text-[32px] leading-tight"
        style={{ color: cardColor }}
      >
        {title}
      </span>
      <div className="flex w-full flex-col items-center gap-1.5 border-t border-dashed border-[#E6E2D6] pt-2.5">
        <span className="text-xs text-ink-faint">{t('invite.personalFor')}</span>
        <span className="text-[19px] font-semibold leading-snug">{guestName}</span>
      </div>
    </section>
  );
}

function ConfirmedState({
  state,
  qrToken,
  token,
  locale,
  date,
  maps,
  onEdit,
}: {
  state: PublicInvitation;
  qrToken: string | null;
  token: string;
  locale: AppLocale;
  date: ReturnType<typeof formatEventDate>;
  maps: string | null;
  onEdit: () => void;
}) {
  const t = translator(locale);
  const { guest, event, invitation } = state;
  const seats = guest.companionsConfirmed + 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F4F9F6]">
      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-5 pb-3 pt-6">
        <div className="flex flex-col items-center gap-2.5">
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-emerald-700 text-[28px] font-light text-[#F7F5EF]">
            ✓
          </div>
          <span className="text-[21px] font-semibold text-status-confirmedFg">
            {t('invite.confirmedTitle')}
          </span>
          <span className="text-center text-[13.5px] leading-relaxed text-ink-muted">
            {guest.companionsConfirmed > 0 &&
              `${t('invite.confirmedWithCompanions', {
                count: displayNumber(guest.companionsConfirmed, locale),
              })} · `}
            {t('invite.confirmedSubtitle', {
              weekday: date.weekday,
              date: date.gregorian,
              time: date.time,
            })}
          </span>
        </div>

        <div className="flex w-full flex-col items-center gap-3.5 rounded-[22px] border border-[#E3EDE8] bg-surface p-5 shadow-[0_14px_34px_-26px_rgba(23,33,29,.6)]">
          <span className="text-xs text-ink-light">{t('invite.showAtDoor')}</span>

          {/* Rendered by the API so the signed payload never has to be assembled
              in the browser. */}
          <img
            src={`${browserApiBase()}/api/invite/${token}/qr.png`}
            alt=""
            width={186}
            height={186}
            className="rounded-[14px] border border-line-soft bg-white p-2.5"
          />

          <div className="flex flex-col items-center gap-1">
            <span className="text-base font-semibold">{guest.name}</span>
            <span className="text-xs text-ink-light">
              {t('invite.seatsAndCode', {
                seats: displayNumber(seats, locale),
                code: invitation.displayCode,
              })}
            </span>
          </div>
          {qrToken && <span className="sr-only">{qrToken}</span>}
        </div>

        <div className="flex w-full gap-2.5">
          <a
            href={`${browserApiBase()}/api/invite/${token}/qr.png`}
            download
            className="flex h-[50px] flex-1 items-center justify-center rounded-[13px] border border-[#CFD6D0] bg-surface text-[14.5px] font-medium"
          >
            {t('invite.saveImage')}
          </a>
          <a
            href={calendarUrl(event)}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-[50px] flex-1 items-center justify-center rounded-[13px] border border-[#CFD6D0] bg-surface text-[14.5px] font-medium"
          >
            {t('invite.addCalendar')}
          </a>
        </div>

        {maps && (
          <div className="flex w-full items-center justify-between rounded-2xl border border-line-soft bg-surface px-4.5 py-3.5">
            <span className="text-sm text-[#3D4741]">{event.venueName}</span>
            <a
              href={maps}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[13.5px] font-semibold text-emerald-700"
            >
              {t('invite.directions')}
            </a>
          </div>
        )}
      </div>

      <div className="border-t border-[#E3EDE8] px-5 py-4 text-center">
        <button
          type="button"
          onClick={onEdit}
          className="text-sm font-medium text-ink-muted underline"
        >
          {t('invite.editResponse')}
        </button>
      </div>
    </div>
  );
}

function DeclinedState({ locale, onReconsider }: { locale: AppLocale; onReconsider: () => void }) {
  const t = translator(locale);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-[#FAF8F3] px-8 text-center">
      <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-surface-sand text-[26px] font-light text-ink-light">
        ♡
      </div>
      <span className="text-[21px] font-semibold">{t('invite.declinedTitle')}</span>
      <p className="max-w-[280px] text-body text-ink-muted">{t('invite.declinedBody')}</p>

      {/* The door back stays open, without nagging. */}
      <div className="flex w-full flex-col items-center gap-1.5 rounded-2xl border border-line-soft bg-surface px-4 py-4">
        <span className="text-[13px] text-ink-light">{t('invite.changedMind')}</span>
        <button
          type="button"
          onClick={onReconsider}
          className="text-[14.5px] font-semibold text-emerald-700"
        >
          {t('invite.canAttendAfterAll')}
        </button>
      </div>
    </div>
  );
}

/** Google Calendar template link — no extra dependency, works everywhere. */
function calendarUrl(event: PublicInvitation['event']): string {
  const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const end =
    event.endsAt ?? new Date(new Date(event.startsAt).getTime() + 3 * 3600_000).toISOString();

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${stamp(event.startsAt)}/${stamp(end)}`,
    location: [event.venueName, event.venueAddress].filter(Boolean).join(', '),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
