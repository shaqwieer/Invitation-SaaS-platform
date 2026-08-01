import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatPercent,
  hasNonWesternDigits,
  toArabicIndicDigits,
  toWesternDigits,
} from './digits.js';

describe('digit transliteration', () => {
  it('converts ASCII to Arabic-Indic', () => {
    expect(toArabicIndicDigits('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  it('converts Arabic-Indic and Persian digits back to ASCII', () => {
    expect(toWesternDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toWesternDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves surrounding text alone', () => {
    expect(toArabicIndicDigits('حتى 300 ضيف')).toBe('حتى ٣٠٠ ضيف');
    expect(toWesternDigits('حتى ٣٠٠ ضيف')).toBe('حتى 300 ضيف');
  });

  it('detects non-Western digits so importers know to normalize', () => {
    expect(hasNonWesternDigits('٠٥٥')).toBe(true);
    expect(hasNonWesternDigits('055')).toBe(false);
  });
});

describe('formatNumber', () => {
  it('renders the design’s dashboard figures', () => {
    expect(formatNumber(320, { digits: 'arabic' })).toBe('٣٢٠');
    expect(formatNumber(186, { digits: 'arabic' })).toBe('١٨٦');
  });

  it('uses the Arabic decimal separator, not a period', () => {
    // The design writes the companion average as ١٫٨ (U+066B), not ١.٨.
    expect(formatNumber(1.8, { digits: 'arabic', minimumFractionDigits: 1 })).toBe('١٫٨');
  });

  it('omits grouping by default and applies it on request', () => {
    expect(formatNumber(5000)).toBe('5000');
    expect(formatNumber(5000, { useGrouping: true })).toBe('5,000');
  });

  it('formats percentages with the Arabic percent sign', () => {
    expect(formatPercent(0.58, 'arabic')).toBe('٥٨٪');
    expect(formatPercent(0.58, 'western')).toBe('58%');
  });
});
