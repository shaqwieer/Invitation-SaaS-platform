import ar from '../../messages/ar.json';
import en from '../../messages/en.json';

export const LOCALES = ['ar', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Arabic is the product's first language, not a translation of the English. */
export const DEFAULT_LOCALE: AppLocale = 'ar';

const CATALOGUES: Record<AppLocale, Record<string, string>> = { ar, en };

export function isLocale(value: string): value is AppLocale {
  return (LOCALES as readonly string[]).includes(value);
}

export function direction(locale: AppLocale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Falls back to the key itself so a missing string is obvious rather than blank. */
export function t(locale: AppLocale, key: string): string {
  return CATALOGUES[locale][key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key;
}
