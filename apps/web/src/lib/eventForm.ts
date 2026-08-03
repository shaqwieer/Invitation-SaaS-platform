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

export const CARD_COLOURS = [
  '#0E5A45',
  '#093127',
  '#A8843C',
  '#8E5F58',
  '#3D4741',
  '#6E5420',
] as const;

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
