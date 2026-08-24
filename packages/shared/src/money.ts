/**
 * Money is stored and computed as integer halalas (1 SAR = 100 halalas).
 *
 * Never floats: 449 + 199 in float arithmetic is exact, but 15% VAT on it is not,
 * and a half-halala drift on an invoice the host forwards to their family is the
 * kind of bug nobody forgives. All arithmetic here is integer; only the final
 * display step divides.
 */
import { formatNumber, type DigitStyle } from './digits.js';

export const HALALAS_PER_SAR = 100;

/** Saudi VAT, 15% since July 2020. Overridable via env for other markets. */
export const DEFAULT_VAT_RATE = 0.15;

export type Halalas = number;

export function sarToHalalas(sar: number): Halalas {
  return Math.round(sar * HALALAS_PER_SAR);
}

export function halalasToSar(halalas: Halalas): number {
  return halalas / HALALAS_PER_SAR;
}

export interface OrderLineItem {
  /** Stable key, e.g. 'package:event-300' or 'addon:custom-card'. */
  key: string;
  labelAr: string;
  labelEn: string;
  unitPrice: Halalas;
  quantity: number;
}

export interface OrderTotals {
  subtotal: Halalas;
  /** Discount applied to the subtotal before VAT is computed. */
  discount: Halalas;
  taxableAmount: Halalas;
  vatRate: number;
  vat: Halalas;
  total: Halalas;
}

export interface ComputeTotalsInput {
  lineItems: OrderLineItem[];
  vatRate?: number;
  discount?: Halalas;
}

/**
 * Sum line items, apply a discount, then VAT.
 *
 * VAT is computed on the discounted amount (ZATCA treats a price reduction as
 * reducing the taxable base), and rounded once at the end rather than per line —
 * per-line rounding drifts on multi-item orders.
 */
export function computeOrderTotals({
  lineItems,
  vatRate = DEFAULT_VAT_RATE,
  discount = 0,
}: ComputeTotalsInput): OrderTotals {
  const subtotal = lineItems.reduce(
    (sum, item) => sum + Math.round(item.unitPrice) * item.quantity,
    0,
  );

  const appliedDiscount = Math.min(Math.max(Math.round(discount), 0), subtotal);
  const taxableAmount = subtotal - appliedDiscount;
  const vat = Math.round(taxableAmount * vatRate);

  return {
    subtotal,
    discount: appliedDiscount,
    taxableAmount,
    vatRate,
    vat,
    total: taxableAmount + vat,
  };
}

export interface FormatMoneyOptions {
  digits?: DigitStyle;
  /** Append the currency label ("ر.س" / "SAR"). */
  withCurrency?: boolean;
}

/**
 * Render halalas as a price string.
 * `formatMoney(74520, { digits: 'arabic' })` → "٧٤٥٫٢٠"
 */
export function formatMoney(halalas: Halalas, options: FormatMoneyOptions = {}): string {
  const { digits = 'western', withCurrency = false } = options;

  const amount = formatNumber(halalasToSar(halalas), {
    digits,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });

  if (!withCurrency) return amount;
  return digits === 'arabic' ? `${amount} ر.س` : `${amount} SAR`;
}

/**
 * How much a compare-at price is marked down, as a whole percentage.
 *
 * Returns `null` whenever there is nothing honest to show — no compare-at, or
 * one that is not strictly above the price. That single return covers the
 * unset case, the equal case and the typo where the two are swapped, so callers
 * need one check (`percent !== null`) rather than three, and no screen can end
 * up rendering «خصم ٠٪» or a negative badge.
 *
 * Rounded to whole percent — a marketing figure sitting next to both real
 * prices, not a number anyone reconciles a receipt against. A markdown too
 * small to round to 1% (249 from 250 is 0.4%) also returns `null`: it is real
 * but not worth a badge, and it is the one input that would otherwise print the
 * «خصم ٠٪» this function promises never to produce.
 *
 * `discountPercent(12900, 25000)` → 48
 */
export function discountPercent(
  priceHalalas: Halalas,
  compareAtHalalas: Halalas | null | undefined,
): number | null {
  if (compareAtHalalas === null || compareAtHalalas === undefined) return null;
  if (compareAtHalalas <= priceHalalas) return null;
  if (compareAtHalalas <= 0) return null;

  const percent = Math.round(((compareAtHalalas - priceHalalas) / compareAtHalalas) * 100);
  return percent > 0 ? percent : null;
}

/** Order numbers look like DW-2026-4821 in the design's success screen. */
export function formatOrderNumber(year: number, sequence: number): string {
  return `DW-${year}-${String(sequence).padStart(4, '0')}`;
}
