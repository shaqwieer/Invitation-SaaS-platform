/**
 * Arabic text normalization for *matching*, never for storage.
 *
 * The same header can arrive as «الجوال», «الجَوّال», «الجــوال» or «الجوال »
 * depending on who typed it and which app exported it. Comparing raw strings
 * misses all but the first. Everything here is lossy on purpose — normalize to
 * compare, keep the original to display.
 */

/** Harakat, tanween, shadda, sukun (U+064B–U+0652) and the superscript alef. */
const DIACRITICS = /[ً-ْٰـ]/g;

/**
 * Fold the letters that Arabic typists treat as interchangeable.
 *
 * Alef forms carry a hamza that is routinely omitted; ta marbuta and ha are
 * confused word-finally; alef maqsura and ya are the same key on many keyboards.
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Normalized, lowercased, whitespace-collapsed — the form used as a lookup key. */
export function matchKey(input: string): string {
  return normalizeArabic(String(input ?? ''))
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
