'use client';

/**
 * The invitation card, as the guest will see it.
 *
 * The design keeps this pinned beside the wizard and the card editor and has it
 * react to every field, so the host sees the invitation before they pay for it.
 * It is deliberately a simplified stand-in for the real invite page rather than
 * a second implementation of it — its job is to show the effect of a colour,
 * a font and a name, not to be pixel-identical.
 */

import { formatEventDate } from '@/lib/format';
import { cardTitleInk } from '@/lib/cardColour';
import type { AppLocale } from '@/lib/i18n';

export function CardPreview({
  title,
  hostName,
  partnerName,
  venueName,
  startsAt,
  timezone,
  cardColor,
  cardTitleFont,
  artworkUrl = null,
  locale,
  t,
}: {
  title: string;
  hostName: string;
  partnerName?: string | null;
  venueName?: string | null;
  startsAt: string;
  timezone: string;
  cardColor: string;
  cardTitleFont: string;
  /** Resolved artwork, or null for a plain coloured card. */
  artworkUrl?: string | null;
  locale: AppLocale;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const date = formatEventDate(startsAt, timezone || 'Asia/Riyadh', locale);
  const hosts = [hostName, partnerName].filter(Boolean).join(locale === 'ar' ? ' و ' : ' & ');

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[12.5px] font-medium text-ink-light">{t('event.preview')}</span>

      {/* Matches the guest card's order exactly — artwork whole on top, the
          message underneath it — so the preview is a promise the invitation
          actually keeps. */}
      <div className="flex flex-col overflow-hidden rounded-card bg-surface shadow-sh-2">
        {artworkUrl && (
          <div className="flex justify-center" style={{ backgroundColor: cardColor }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- host artwork */}
            <img src={artworkUrl} alt="" className="max-h-[420px] w-full object-contain" />
          </div>
        )}

        <div className="flex flex-col items-center gap-3.5 px-6 py-7 text-center">
          <span className="text-[11px] text-ink-faint">بسم الله الرحمن الرحيم</span>

          <span className="text-[12.5px] text-ink-muted">{hosts || t('event.hostName')}</span>

          <h3
            className={`text-[26px] leading-relaxed ${
              cardTitleFont === 'amiri' ? 'font-serif' : 'font-sans'
            }`}
            style={{ color: cardTitleInk(cardColor) }}
          >
            {title || t('event.title')}
          </h3>

          <div className="h-px w-12 bg-gold" />

          <div className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
            <span>{date.weekday}</span>
            <span>{date.gregorian}</span>
            <span>{date.hijri}</span>
            <span>{date.time}</span>
            {venueName && <span className="mt-1 text-ink-light">{venueName}</span>}
          </div>

          <div className="mt-2 w-full rounded-control border border-dashed border-line-strong px-4 py-4 text-[11.5px] text-ink-faint">
            {t('event.previewGuestSlot')}
          </div>
        </div>
      </div>

      <span className="text-[12px] leading-relaxed text-ink-light">{t('event.previewNote')}</span>
    </div>
  );
}
