import { discountPercent, formatMoney } from '@da3wa/shared';
import { displayNumber } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';

/**
 * A package's price, with the offer attached when there is one.
 *
 * ٢٥٠ struck through, ١٢٩ beside it, «خصم ٤٨٪» under it — the shape the operator
 * asked for. It lives in one component because the same price is rendered on the
 * landing page and in the wizard's package step, and an offer that appears on
 * one but not the other reads as a bug in the price rather than in the markup.
 *
 * The percentage is derived from the two amounts, never typed by an operator, so
 * it cannot drift the first time someone edits a price and forgets the badge.
 * `discountPercent` returns null for every case where there is nothing honest to
 * show — no compare-at, one that is not above the price, or a markdown too small
 * to round to 1% — so the whole offer block hangs off a single null check.
 */
export function PackagePrice({
  priceHalalas,
  compareAtHalalas,
  locale,
  currencyLabel,
  discountLabel,
  size = 'md',
}: {
  priceHalalas: number;
  compareAtHalalas: number | null;
  locale: AppLocale;
  /** "ر.س" / "SAR", already translated by the caller. */
  currencyLabel: string;
  /** Builds "خصم ٤٨٪" from the percentage. */
  discountLabel: (percent: string) => string;
  size?: 'md' | 'lg';
}) {
  const digits = locale === 'ar' ? 'arabic' : 'western';
  const percent = discountPercent(priceHalalas, compareAtHalalas);

  // Arabic-indic for the badge too — a Latin "48%" beside ١٢٩٫٠٠ looks like a
  // different system wrote it. Null-safe because the badge is only read inside
  // the `percent !== null` branches below.
  const percentText = displayNumber(percent ?? 0, locale);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={`font-semibold leading-none ${size === 'lg' ? 'text-[30px]' : 'text-[26px]'}`}
        >
          {formatMoney(priceHalalas, { digits })}
        </span>
        <span className="text-[13px] font-normal text-ink-light">{currencyLabel}</span>

        {percent !== null && (
          /*
           * `line-through` alone is ambiguous next to a second price, so the old
           * amount is also muted and a size smaller. `aria-hidden` is wrong here
           * — the struck price is meaningful to a screen reader — but it needs
           * saying rather than reading as a second live price, hence the label.
           */
          <span className="text-[15px] text-ink-light line-through decoration-[1.5px]">
            <span className="sr-only">{discountLabel(percentText)} — </span>
            {formatMoney(compareAtHalalas!, { digits })}
          </span>
        )}
      </div>

      {percent !== null && (
        <span className="self-start rounded-chip bg-emerald-700/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-800">
          {discountLabel(percentText)}
        </span>
      )}
    </div>
  );
}
