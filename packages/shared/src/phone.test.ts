import { describe, expect, it } from 'vitest';
import {
  formatPhoneForDisplay,
  normalizePhone,
  toWhatsAppNumber,
  type PhoneSuccess,
} from './phone.js';

/** Narrow to the success branch, failing loudly with the reason if it didn't parse. */
function ok(raw: string, country?: Parameters<typeof normalizePhone>[1]): PhoneSuccess {
  const result = normalizePhone(raw, country);
  if (!result.ok) throw new Error(`expected "${raw}" to parse, got ${result.reason}`);
  return result;
}

describe('normalizePhone — Saudi', () => {
  // Every one of these is the same guest arriving from a different source.
  it.each([
    ['0554128830', 'local with trunk prefix'],
    ['554128830', 'local without trunk prefix'],
    ['966554128830', 'dial code, no plus'],
    ['+966554128830', 'already E.164'],
    ['00966554128830', 'international access prefix'],
    ['+966 55 412 8830', 'spaced'],
    ['+966-55-412-8830', 'dashed'],
    ['(966) 55 412 8830', 'parenthesised'],
    ['٠٥٥٤١٢٨٨٣٠', 'Arabic-Indic digits'],
    ['۰۵۵۴۱۲۸۸۳۰', 'Persian digits'],
  ])('normalizes %s (%s)', (input) => {
    expect(ok(input).e164).toBe('+966554128830');
  });

  it('reports which inputs it had to rewrite', () => {
    // Drives the import screen's "وحّدنا صيغة ٨٣ رقمًا تلقائيًا" counter.
    expect(ok('+966554128830').wasReformatted).toBe(false);
    expect(ok('0554128830').wasReformatted).toBe(true);
    expect(ok('966554128830').wasReformatted).toBe(true);
  });

  it('accepts every Saudi mobile prefix', () => {
    for (const n of ['0501234567', '0531234567', '0541234567', '0561234567', '0591234567']) {
      expect(ok(n).country).toBe('SA');
    }
  });
});

describe('normalizePhone — other Gulf countries', () => {
  it('normalizes a UAE number but flags it as out-of-country', () => {
    // The import error screen shows exactly this number with an "اقبله" action,
    // so it must parse rather than fail.
    const result = ok('+971 50 118 2233');
    expect(result.e164).toBe('+971501182233');
    expect(result.country).toBe('AE');
    expect(result.isDefaultCountry).toBe(false);
  });

  it.each([
    ['+96551234567', 'KW', '+96551234567'],
    ['+97433123456', 'QA', '+97433123456'],
    ['+97336123456', 'BH', '+97336123456'],
    ['+96879123456', 'OM', '+96879123456'],
  ])('normalizes %s as %s', (input, country, e164) => {
    const result = ok(input);
    expect(result.country).toBe(country);
    expect(result.e164).toBe(e164);
  });

  it('treats a bare local number as the default country, not another Gulf state', () => {
    expect(ok('551234567', 'AE').e164).toBe('+971551234567');
    expect(ok('551234567', 'SA').e164).toBe('+966551234567');
  });
});

describe('normalizePhone — rejections', () => {
  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['05012345', 'TOO_SHORT'], // the design's row-14 import error
    ['05012345678901', 'TOO_LONG'],
    ['0412345678', 'NOT_A_MOBILE'], // landline, not a mobile
    ['abcdefghij', 'INVALID_CHARACTERS'],
    ['+1 555 123 4567', 'UNSUPPORTED_COUNTRY'],
  ])('rejects %s as %s', (input, reason) => {
    const result = normalizePhone(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('does not reinterpret an explicit international number as a local one', () => {
    // '+966123' is a broken Saudi number. Falling back to "local number under the
    // default country" would be wrong — the caller said +966 explicitly.
    const result = normalizePhone('+966123');
    expect(result.ok).toBe(false);
  });
});

describe('display helpers', () => {
  it('groups a 9-digit national number the way the design shows it', () => {
    expect(formatPhoneForDisplay('+966554128830')).toBe('+966 55 412 8830');
    expect(formatPhoneForDisplay('+971501182233')).toBe('+971 50 118 2233');
  });

  it('groups an 8-digit national number', () => {
    expect(formatPhoneForDisplay('+96551234567')).toBe('+965 5123 4567');
  });

  it('strips everything non-numeric for wa.me links', () => {
    expect(toWhatsAppNumber('+966554128830')).toBe('966554128830');
  });
});
