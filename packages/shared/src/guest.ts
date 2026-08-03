/**
 * Guest identity, when there may not be one yet.
 *
 * A delegated invitation exists before anyone knows whose it is: the host mints
 * a block of slots, the delegate forwards the links, and the name arrives later
 * — from her as she sends, or from the guest at RSVP.
 *
 * `Guest.name` is therefore nullable, and every screen that shows a guest has to
 * agree on what a nameless one looks like. That decision lives here rather than
 * in seven components, because the alternative is a card reading «دعوة خاصة لـ»
 * with nothing after it on one screen and «—» on the next.
 */

import type { Locale } from './enums.js';

/** «ضيفنا الكريم» — a form of address, not a placeholder. */
const UNNAMED: Record<Locale, string> = {
  ar: 'ضيفنا الكريم',
  en: 'Our guest',
};

/**
 * What to print where a guest's name goes.
 *
 * Deliberately not "Guest #12" or an id: this string is read by the guest
 * themselves, on their own invitation, and a slot number tells them they were
 * an afterthought.
 */
export function guestDisplayName(name: string | null | undefined, locale: Locale = 'ar'): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNNAMED[locale];
}

/**
 * The name for a spreadsheet cell or a report row.
 *
 * Empty rather than «ضيفنا الكريم»: an export is read by the host, who is
 * counting people and needs to see at a glance which rows nobody has claimed.
 * The polite form belongs on the guest's own screen, not in their accounting.
 */
export function guestExportName(name: string | null | undefined): string {
  return name?.trim() ?? '';
}
