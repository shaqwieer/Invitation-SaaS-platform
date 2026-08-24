/**
 * Shared bits between the event wizard and the settings page, so the two can
 * never disagree about what a valid event looks like.
 */

export const EVENT_TYPES = [
  'WEDDING',
  'ENGAGEMENT',
  'GRADUATION',
  'CORPORATE',
  'OTHER',
] as const;

export const EVENT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

/**
 * ISO ⇄ `datetime-local`.
 *
 * `<input type="datetime-local">` speaks local wall-clock time with no zone, so
 * the value has to be shifted by the browser's offset on the way in and back
 * again on the way out. Passing an ISO string straight into the input silently
 * renders nothing, which looks like an empty field rather than a bug.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function toIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * A pasted map link, made acceptable to `z.string().url()`.
 *
 * Nobody copies a scheme. Google's share sheet gives `maps.app.goo.gl/abc`, and
 * a host typing the venue's site types `qasr.com` — both of which the schema
 * rejects as malformed, producing a validation error against a field the host
 * can see is perfectly fine. Prepending `https://` is what a browser's address
 * bar does with the same input.
 *
 * Returns null for empty input so the caller can clear the column, and leaves
 * anything already carrying a scheme untouched — including `http://`, which is
 * not ours to upgrade silently.
 *
 * Deliberately not a validator: a string this cannot rescue is passed through
 * unchanged so the schema, not this function, decides what a URL is and reports
 * it in one voice.
 */
export function normaliseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // A bare `//host` is scheme-relative and meaningless once stored, so it is
  // treated as missing a scheme rather than having an empty one.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}
