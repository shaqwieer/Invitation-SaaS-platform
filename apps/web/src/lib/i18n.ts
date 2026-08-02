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

/**
 * Look up a string, substituting {placeholders}.
 *
 * Falls back to the key itself so a missing string is loud rather than blank —
 * an empty invitation card is worse than a visible `invite.accept`.
 */
export function t(
  locale: AppLocale,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = CATALOGUES[locale][key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Bind a locale once so components don't thread it through every call. */
export function translator(locale: AppLocale) {
  return (key: string, params?: Record<string, string | number>) => t(locale, key, params);
}
