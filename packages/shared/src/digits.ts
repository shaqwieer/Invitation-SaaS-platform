/**
 * Arabic-Indic numeral handling.
 *
 * The design toggles between ٠١٢٣٤٥٦٧٨٩ and 0123456789 throughout (the `digits`
 * prop on the design doc). Guest-facing surfaces default to Arabic-Indic in the
 * `ar` locale; anything a machine reads back — phone numbers, tokens, codes —
 * stays Western.
 */

/** U+0660–U+0669. Used across the Arab world, and by the design. */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
/** U+06F0–U+06F9. Persian/Urdu variants — imported spreadsheets do contain these. */
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Arabic decimal separator (U+066B) and thousands separator (U+066C). */
export const ARABIC_DECIMAL_SEPARATOR = '٫';
export const ARABIC_THOUSANDS_SEPARATOR = '٬';

export type DigitStyle = 'arabic' | 'western';

/** Rewrite ASCII digits as Arabic-Indic. Non-digits pass through untouched. */
export function toArabicIndicDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]!);
}

/**
 * Rewrite Arabic-Indic *and* Persian digits as ASCII.
 *
 * Always run this before parsing anything a human typed or a spreadsheet
 * supplied — Excel exports from Arabic-locale machines are full of U+0660s, and
 * `Number('٠٥٥')` is NaN.
 */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const arabicIndex = ARABIC_INDIC.indexOf(ch);
    if (arabicIndex !== -1) return String(arabicIndex);
    return String(EXTENDED_ARABIC_INDIC.indexOf(ch));
  });
}

/** True if the string contains any non-ASCII digit form. */
export function hasNonWesternDigits(input: string): boolean {
  return /[٠-٩۰-۹]/.test(input);
}

export interface FormatNumberOptions {
  digits?: DigitStyle;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Insert thousands separators. Off by default — the design's stat tiles don't use them. */
  useGrouping?: boolean;
}

/**
 * Format a number for display.
 *
 * Deliberately does not use `Intl.NumberFormat('ar-SA')`: its output varies by
 * ICU version, which makes both tests and server/client rendering unstable.
 * We format in a fixed locale and transliterate, so the result is identical
 * everywhere.
 */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  const {
    digits = 'western',
    minimumFractionDigits = 0,
    maximumFractionDigits = Math.max(minimumFractionDigits, 0),
    useGrouping = false,
  } = options;

  const western = new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  }).format(value);

  if (digits === 'western') return western;

  return toArabicIndicDigits(western)
    .replace(/\./g, ARABIC_DECIMAL_SEPARATOR)
    .replace(/,/g, ARABIC_THOUSANDS_SEPARATOR);
}

/** Percentage with the design's conventions: no decimals, trailing ٪ / %. */
export function formatPercent(ratio: number, digits: DigitStyle = 'western'): string {
  const pct = formatNumber(Math.round(ratio * 100), { digits });
  return digits === 'arabic' ? `${pct}٪` : `${pct}%`;
}
