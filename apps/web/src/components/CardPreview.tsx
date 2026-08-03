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

      <div
        className="relative flex flex-col items-center gap-4 overflow-hidden rounded-card px-6 py-9 text-center shadow-sh-2"
        style={{ backgroundColor: cardColor }}
      >
        {/* Matches the guest card exactly: artwork behind a scrim, so the preview
            is a promise the invitation actually keeps. */}
        {artworkUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- host artwork */}
            <img src={artworkUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15" />
          </>
        )}

        <span className="relative text-[11px] text-white/60">بسم الله الرحمن الرحيم</span>

        <span className="relative text-[12.5px] text-white/75">
          {hosts || t('event.hostName')}
        </span>

        <h3
          className={`relative text-[26px] leading-relaxed text-[#FFFDF7] ${
            cardTitleFont === 'amiri' ? 'font-serif' : 'font-sans'
          }`}
        >
          {title || t('event.title')}
        </h3>

        <div className="relative h-px w-12 bg-gold" />

        <div className="relative flex flex-col gap-1 text-[12.5px] text-white/80">
          <span>{date.weekday}</span>
          <span>{date.gregorian}</span>
          <span>{date.hijri}</span>
          <span>{date.time}</span>
          {venueName && <span className="mt-1 text-white/70">{venueName}</span>}
        </div>

        <div className="relative mt-3 w-full rounded-control border border-dashed border-white/25 px-4 py-4 text-[11.5px] text-white/50">
          {t('event.previewGuestSlot')}
        </div>
      </div>

      <span className="text-[12px] leading-relaxed text-ink-light">{t('event.previewNote')}</span>
    </div>
  );
}
