/**
 * Gulf phone normalization to E.164.
 *
 * Guest lists arrive from Excel, from contacts apps, and from people typing by
 * hand, so the same number shows up as 0554128830, 554128830, 966554128830,
 * +966 55 412 8830, 00966554128830, and ٠٥٥٤١٢٨٨٣٠. All of those are one guest.
 * The import screen reports how many it rewrote ("وحّدنا صيغة ٨٣ رقمًا تلقائيًا").
 *
 * Non-Saudi Gulf numbers are normalized too, not rejected — the import error
 * screen offers "اقبله" for a +971 number rather than dropping the row. Callers
 * decide what to do with `isDefaultCountry === false`.
 */
import { toWesternDigits } from './digits.js';

export type CountryCode = 'SA' | 'AE' | 'KW' | 'QA' | 'BH' | 'OM';

interface CountryRule {
  /** Dialing code without '+'. */
  dialCode: string;
  /** Length of the national significant number (mobile). */
  nationalLength: number;
  /** Allowed first digit(s) of a mobile national number. */
  mobilePrefixes: readonly string[];
  /** Digit stripped when dialing domestically, if any. */
  trunkPrefix?: string;
  nameEn: string;
  nameAr: string;
}

const COUNTRIES: Record<CountryCode, CountryRule> = {
  SA: {
    dialCode: '966',
    nationalLength: 9,
    mobilePrefixes: ['5'],
    trunkPrefix: '0',
    nameEn: 'Saudi Arabia',
    nameAr: 'السعودية',
  },
  AE: {
    dialCode: '971',
    nationalLength: 9,
    mobilePrefixes: ['5'],
    trunkPrefix: '0',
    nameEn: 'United Arab Emirates',
    nameAr: 'الإمارات',
  },
  KW: {
    dialCode: '965',
    nationalLength: 8,
    mobilePrefixes: ['5', '6', '9'],
    nameEn: 'Kuwait',
    nameAr: 'الكويت',
  },
  QA: {
    dialCode: '974',
    nationalLength: 8,
    mobilePrefixes: ['3', '5', '6', '7'],
    nameEn: 'Qatar',
    nameAr: 'قطر',
  },
  BH: {
    dialCode: '973',
    nationalLength: 8,
    mobilePrefixes: ['3', '6'],
    nameEn: 'Bahrain',
    nameAr: 'البحرين',
  },
  OM: {
    dialCode: '968',
    nationalLength: 8,
    mobilePrefixes: ['7', '9'],
    nameEn: 'Oman',
    nameAr: 'عُمان',
  },
};

/** Longest dial code first so no country shadows another. */
const COUNTRY_ENTRIES = (Object.entries(COUNTRIES) as [CountryCode, CountryRule][]).sort(
  (a, b) => b[1].dialCode.length - a[1].dialCode.length,
);

export type PhoneErrorReason =
  | 'EMPTY'
  | 'INVALID_CHARACTERS'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'NOT_A_MOBILE'
  | 'UNSUPPORTED_COUNTRY';

export interface PhoneSuccess {
  ok: true;
  /** E.164, e.g. +966554128830. This is what gets stored. */
  e164: string;
  country: CountryCode;
  /** National significant number, e.g. 554128830. */
  national: string;
  /** False for a number outside the list's expected country — surfaced, not rejected. */
  isDefaultCountry: boolean;
  /** True when the input was not already in E.164 form (drives the "we reformatted N" count). */
  wasReformatted: boolean;
}

export interface PhoneFailure {
  ok: false;
  reason: PhoneErrorReason;
}

export type PhoneResult = PhoneSuccess | PhoneFailure;

function validateNational(national: string, rule: CountryRule): PhoneErrorReason | null {
  if (national.length < rule.nationalLength) return 'TOO_SHORT';
  if (national.length > rule.nationalLength) return 'TOO_LONG';
  if (!rule.mobilePrefixes.some((p) => national.startsWith(p))) return 'NOT_A_MOBILE';
  return null;
}

/**
 * Normalize a raw phone string to E.164.
 *
 * @param raw            Anything a human or spreadsheet produced.
 * @param defaultCountry Country assumed when the input carries no dial code.
 */
export function normalizePhone(raw: string, defaultCountry: CountryCode = 'SA'): PhoneResult {
  if (raw == null) return { ok: false, reason: 'EMPTY' };

  // Arabic-Indic digits first, then drop the punctuation people use as separators:
  // spaces, dashes, dots, parentheses, and RTL/LTR marks that Excel loves to inject.
  const western = toWesternDigits(String(raw));
  const cleaned = western.replace(/[\s\-().‎‏؜ ]/g, '');

  if (cleaned.length === 0) return { ok: false, reason: 'EMPTY' };
  if (!/^\+?\d+$/.test(cleaned)) return { ok: false, reason: 'INVALID_CHARACTERS' };

  const hadPlus = cleaned.startsWith('+');
  let digits = hadPlus ? cleaned.slice(1) : cleaned;

  // 00 is the international access prefix — same meaning as '+'.
  let hadInternationalPrefix = hadPlus;
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
    hadInternationalPrefix = true;
  }

  // Interpretation 1: the number carries its own dial code.
  for (const [code, rule] of COUNTRY_ENTRIES) {
    if (!digits.startsWith(rule.dialCode)) continue;
    const national = digits.slice(rule.dialCode.length);
    if (validateNational(national, rule) === null) {
      return {
        ok: true,
        e164: `+${rule.dialCode}${national}`,
        country: code,
        national,
        isDefaultCountry: code === defaultCountry,
        wasReformatted: !(hadPlus && cleaned === `+${rule.dialCode}${national}`),
      };
    }
  }

  // An explicit + or 00 means the dial code was supposed to be there. Don't
  // silently reinterpret it as a local number under the default country.
  if (hadInternationalPrefix) {
    const known = COUNTRY_ENTRIES.find(([, r]) => digits.startsWith(r.dialCode));
    if (!known) return { ok: false, reason: 'UNSUPPORTED_COUNTRY' };
    const rule = known[1];
    return { ok: false, reason: validateNational(digits.slice(rule.dialCode.length), rule)! };
  }

  // Interpretation 2: a local number, with or without the trunk prefix.
  const rule = COUNTRIES[defaultCountry];
  const national =
    rule.trunkPrefix && digits.startsWith(rule.trunkPrefix) ? digits.slice(1) : digits;

  const problem = validateNational(national, rule);
  if (problem) return { ok: false, reason: problem };

  return {
    ok: true,
    e164: `+${rule.dialCode}${national}`,
    country: defaultCountry,
    national,
    isDefaultCountry: true,
    wasReformatted: true,
  };
}

/** Convenience wrapper for validators that only care whether it parsed. */
export function isValidPhone(raw: string, defaultCountry: CountryCode = 'SA'): boolean {
  return normalizePhone(raw, defaultCountry).ok;
}

/**
 * Group an E.164 number for display: +966554128830 → "+966 55 412 8830".
 * Always rendered LTR even inside an RTL page — see the design's §02 note.
 */
export function formatPhoneForDisplay(e164: string): string {
  const match = /^\+(\d{3})(\d+)$/.exec(e164);
  if (!match) return e164;
  const [, dialCode, national] = match as unknown as [string, string, string];

  const groups =
    national.length === 9
      ? [national.slice(0, 2), national.slice(2, 5), national.slice(5)]
      : [national.slice(0, 4), national.slice(4)];

  return `+${dialCode} ${groups.filter(Boolean).join(' ')}`;
}

/** wa.me wants bare digits — no '+', no spaces. */
export function toWhatsAppNumber(e164: string): string {
  return e164.replace(/\D/g, '');
}

export function countryLabel(code: CountryCode): { en: string; ar: string } {
  return { en: COUNTRIES[code].nameEn, ar: COUNTRIES[code].nameAr };
}

export const SUPPORTED_COUNTRIES = Object.keys(COUNTRIES) as CountryCode[];
