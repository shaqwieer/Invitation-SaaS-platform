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

/**
 * Where «افتح الموقع في الخرائط» should go.
 *
 * Four sources, best first. The order is the whole point: a link the host chose
 * beats coordinates, coordinates beat a text search, and a text search that
 * includes the address beats one that does not.
 *
 * The last two rules exist because of a real complaint — a wedding at «القصر»
 * whose button opened a Jeddah-wide search listing قاعة القصر, قصر النخبة,
 * قصر البرياني and a kitchenware shop. Two things were wrong:
 *
 *  1. The wizard never collected a map URL, so `venueMapUrl` was always null for
 *     an event created there (fixed at the form; see the wizard).
 *  2. A host who pasted their link into the venue *name* or *address* box had it
 *     searched for as if it were prose. Those two fields are checked for a URL
 *     before being used as search text — recovering the intent rather than
 *     geocoding `https://maps.app.goo.gl/…` as a place name.
 *
 * Rule 2 is a rescue, not a feature: a host who fills the map field correctly
 * never reaches it.
 */
export function mapsUrl(event: {
  venueMapUrl: string | null;
  venueLat: number | null;
  venueLng: number | null;
  venueName: string | null;
  venueAddress?: string | null;
}): string | null {
  if (event.venueMapUrl) return event.venueMapUrl;

  // A link is a link wherever it was typed.
  const strayLink = asHttpUrl(event.venueName) ?? asHttpUrl(event.venueAddress);
  if (strayLink) return strayLink;

  // Exact, and immune to however Google reads the name.
  if (event.venueLat !== null && event.venueLng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${event.venueLat},${event.venueLng}`;
  }

  /*
   * Name *and* address. «القصر» alone matches half the halls in the city;
   * «القصر، طريق الملك فهد، جدة» lands on one. Joined with a comma because that
   * is how Google's own geocoder expects a place and its locality.
   */
  const query = [event.venueName, event.venueAddress]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join('، ');

  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  return null;
}

/**
 * The string as an http(s) URL, or null if it is ordinary text.
 *
 * Only `http`/`https` are accepted. `URL` alone would happily parse `mailto:`
 * and `javascript:`, and this feeds an `href` on a public page — so the scheme
 * allowlist is the security boundary, not a formality.
 *
 * A bare `maps.app.goo.gl/abc` is *not* rescued here: text with a dot in it is
 * far more often an address than a URL, and guessing wrong would send a guest
 * to a nonexistent site instead of showing them the venue. The place to accept
 * a scheme-less link is the form that asks for one, where `normaliseUrl` does
 * exactly that.
 */
function asHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}
