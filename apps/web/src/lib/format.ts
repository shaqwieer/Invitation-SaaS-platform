import { toArabicIndicDigits } from '@da3wa/shared';
import type { AppLocale } from './i18n';

/**
 * Event dates, formatted the way the design shows them.
 *
 * Gulf families coordinate on both calendars — the design puts the Hijri date
 * directly under the Gregorian one on the card, the wizard and the invite page.
 * The Hijri date is *derived* from startsAt, never stored: storing it would
 * require picking a conversion at write time and being unable to correct it.
 */
export interface FormattedEventDate {
  gregorian: string;
  hijri: string;
  time: string;
  weekday: string;
}

function safeFormat(
  value: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  fallback = '',
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(value);
  } catch {
    // A bad IANA zone or a runtime without the Islamic calendar must not blank
    // the whole invitation.
    return fallback;
  }
}

export function formatEventDate(
  startsAt: string | Date,
  timezone: string,
  locale: AppLocale,
): FormattedEventDate {
  const date = new Date(startsAt);
  if (!Number.isFinite(date.getTime())) {
    return { gregorian: '', hijri: '', time: '', weekday: '' };
  }

  const zone = timezone || 'Asia/Riyadh';
  const tag = locale === 'ar' ? 'ar-SA' : 'en-GB';

  const gregorian = safeFormat(date, `${tag}-u-ca-gregory`, {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const weekday = safeFormat(date, tag, { timeZone: zone, weekday: 'long' });

  // Umm al-Qura is the civil calendar in Saudi Arabia; the generic 'islamic'
  // calendar can differ by a day.
  const hijri = safeFormat(date, `${tag}-u-ca-islamic-umalqura`, {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const time = safeFormat(date, tag, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { gregorian, hijri, time, weekday };
}

/** Numerals for display. Arabic surfaces use ٠١٢٣٤٥٦٧٨٩; Latin ones do not. */
export function displayNumber(value: number, locale: AppLocale): string {
  return locale === 'ar' ? toArabicIndicDigits(String(value)) : String(value);
}

/** Google Maps link from coordinates, or the host's own URL if they supplied one. */
export function mapsUrl(event: {
  venueMapUrl: string | null;
  venueLat: number | null;
  venueLng: number | null;
  venueName: string | null;
}): string | null {
  if (event.venueMapUrl) return event.venueMapUrl;
  if (event.venueLat !== null && event.venueLng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${event.venueLat},${event.venueLng}`;
  }
  if (event.venueName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venueName)}`;
  }
  return null;
}
