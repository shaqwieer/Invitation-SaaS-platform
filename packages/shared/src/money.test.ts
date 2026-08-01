import { describe, expect, it } from 'vitest';
import {
  computeOrderTotals,
  formatMoney,
  formatOrderNumber,
  halalasToSar,
  sarToHalalas,
  type OrderLineItem,
} from './money.js';

const packageLine: OrderLineItem = {
  key: 'package:event-300',
  labelAr: 'باقة المناسبة',
  labelEn: 'Event package',
  unitPrice: sarToHalalas(449),
  quantity: 1,
};

const addonLine: OrderLineItem = {
  key: 'addon:custom-card',
  labelAr: 'تصميم بطاقة مخصص',
  labelEn: 'Custom card design',
  unitPrice: sarToHalalas(199),
  quantity: 1,
};

describe('computeOrderTotals', () => {
  it('reproduces the checkout screen exactly', () => {
    // The design's §11 invoice: 449 + 199 = 648, VAT 97.20, total 745.20.
    const totals = computeOrderTotals({ lineItems: [packageLine, addonLine] });

    expect(totals.subtotal).toBe(64800);
    expect(totals.vat).toBe(9720);
    expect(totals.total).toBe(74520);
    expect(formatMoney(totals.total)).toBe('745.20');
    expect(formatMoney(totals.total, { digits: 'arabic' })).toBe('٧٤٥٫٢٠');
  });

  it('taxes the discounted amount, not the gross subtotal', () => {
    const totals = computeOrderTotals({
      lineItems: [packageLine, addonLine],
      discount: sarToHalalas(48),
    });

    expect(totals.taxableAmount).toBe(60000);
    expect(totals.vat).toBe(9000);
    expect(totals.total).toBe(69000);
  });

  it('never lets a discount push the total below zero', () => {
    const totals = computeOrderTotals({
      lineItems: [packageLine],
      discount: sarToHalalas(10_000),
    });

    expect(totals.discount).toBe(totals.subtotal);
    expect(totals.total).toBe(0);
  });

  it('ignores a negative discount rather than treating it as a surcharge', () => {
    const totals = computeOrderTotals({ lineItems: [packageLine], discount: -5000 });
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(51635);
  });

  it('rounds VAT once on the total, not per line', () => {
    // 3 × 33.33 SAR = 99.99. VAT at 15% is 14.9985 → 15.00 (1500 halalas).
    // Rounding per line would give 3 × 500 = 1500 here but drifts on other inputs;
    // this pins the single-rounding behaviour.
    const totals = computeOrderTotals({
      lineItems: [{ ...packageLine, unitPrice: 3333, quantity: 3 }],
    });

    expect(totals.subtotal).toBe(9999);
    expect(totals.vat).toBe(1500);
    expect(totals.total).toBe(11499);
  });

  it('handles an empty order', () => {
    const totals = computeOrderTotals({ lineItems: [] });
    expect(totals).toMatchObject({ subtotal: 0, vat: 0, total: 0 });
  });
});

describe('conversions and formatting', () => {
  it('round-trips SAR and halalas', () => {
    expect(sarToHalalas(249)).toBe(24900);
    expect(halalasToSar(24900)).toBe(249);
  });

  it('groups thousands with the Arabic separator', () => {
    expect(formatMoney(sarToHalalas(1234.5), { digits: 'western' })).toBe('1,234.50');
    expect(formatMoney(sarToHalalas(1234.5), { digits: 'arabic' })).toBe('١٬٢٣٤٫٥٠');
  });

  it('appends the right currency label per digit style', () => {
    expect(formatMoney(74520, { withCurrency: true })).toBe('745.20 SAR');
    expect(formatMoney(74520, { digits: 'arabic', withCurrency: true })).toBe('٧٤٥٫٢٠ ر.س');
  });

  it('formats order numbers the way the success screen shows them', () => {
    expect(formatOrderNumber(2026, 4821)).toBe('DW-2026-4821');
    expect(formatOrderNumber(2026, 7)).toBe('DW-2026-0007');
  });
});
