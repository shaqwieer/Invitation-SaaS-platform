import { describe, expect, it } from 'vitest';
import {
  dedupeImportRows,
  detectColumnMapping,
  validateImportRow,
  type ValidImportRow,
} from './import.js';

describe('detectColumnMapping', () => {
  it('maps the design’s example sheet', () => {
    // The columns shown on the mapping screen: الاسم الكامل · الجوال · عدد الأفراد · ملاحظات
    const { columns, confidence } = detectColumnMapping([
      'الاسم الكامل',
      'الجوال',
      'عدد الأفراد',
      'ملاحظات',
    ]);

    expect(columns.name).toBe(0);
    expect(columns.phone).toBe(1);
    expect(columns.companions).toBe(2);
    expect(columns.group).toBe(3);
    expect(confidence.name).toBe('auto');
    expect(confidence.phone).toBe('auto');
  });

  it('maps English headers', () => {
    const { columns } = detectColumnMapping(['Full Name', 'Mobile', 'Companions', 'Group']);
    expect(columns).toMatchObject({ name: 0, phone: 1, companions: 2, group: 3 });
  });

  it('ignores diacritics, tatweel and alef spelling', () => {
    // «الجــوال» with tatweel, and «الاسم» written with a hamza.
    const { columns } = detectColumnMapping(['الأسم', 'الجــوال']);
    expect(columns.name).toBe(0);
    expect(columns.phone).toBe(1);
  });

  it('prefers the specific header when a generic one is also present', () => {
    // "رقم" alone is a row counter; "رقم الجوال" is the real phone column.
    const { columns } = detectColumnMapping(['رقم', 'الاسم', 'رقم الجوال']);
    expect(columns.phone).toBe(2);
  });

  it('never assigns one column to two fields', () => {
    const { columns } = detectColumnMapping(['الاسم', 'الجوال']);
    const assigned = Object.values(columns).filter((v): v is number => v !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('reports unmatched fields rather than guessing', () => {
    const { columns, confidence } = detectColumnMapping(['الاسم', 'الجوال']);
    expect(columns.section).toBeNull();
    expect(confidence.section).toBe('none');
  });

  it('flags a loose match for review instead of trusting it', () => {
    const { columns, confidence } = detectColumnMapping(['اسم الضيف الكريم', 'رقم الجوال']);
    expect(columns.name).toBe(0);
    expect(confidence.name).toBe('review');
  });

  it('survives blank and duplicated headers', () => {
    const { columns } = detectColumnMapping(['', 'الاسم', '', 'الجوال']);
    expect(columns.name).toBe(1);
    expect(columns.phone).toBe(3);
  });
});

describe('validateImportRow', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    rowNumber: 1,
    name: 'أ. فيصل السبيعي',
    phone: '0554128830',
    ...over,
  });

  it('accepts a good row and normalizes the phone', () => {
    const result = validateImportRow(row());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phone).toBe('+966554128830');
      expect(result.value.warnings.map((w) => w.code)).toContain('PHONE_REFORMATTED');
    }
  });

  it('rejects the design’s two error rows', () => {
    // Row 14: "05012345" — short. Row 29: name blank.
    const short = validateImportRow(row({ rowNumber: 14, phone: '05012345' }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.issues[0]!.code).toBe('PHONE_TOO_SHORT');

    const noName = validateImportRow(row({ rowNumber: 29, name: '  ' }));
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error.issues[0]!.code).toBe('NAME_REQUIRED');
  });

  it('accepts a foreign number and warns instead of failing it', () => {
    // The design offers «اقبله» on the +971 row rather than dropping the guest.
    const result = validateImportRow(row({ phone: '+971 50 118 2233' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.warnings.map((w) => w.code)).toContain('PHONE_FOREIGN');
  });

  it('rejects a foreign number when the host declines it', () => {
    const result = validateImportRow(row({ phone: '+971501182233' }), {
      allowForeignNumbers: false,
    });
    expect(result.ok).toBe(false);
  });

  it('treats a blank companions cell as zero, not an error', () => {
    for (const blank of ['', '   ', null, undefined]) {
      const result = validateImportRow(row({ companions: blank }));
      expect(result.ok, `companions=${JSON.stringify(blank)}`).toBe(true);
      if (result.ok) expect(result.value.companionsAllowed).toBe(0);
    }
  });

  it('reads Arabic-Indic companion counts', () => {
    const result = validateImportRow(row({ companions: '٣' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.companionsAllowed).toBe(3);
  });

  it('clamps an absurd companion count rather than losing the guest', () => {
    const result = validateImportRow(row({ companions: 99 }), { maxCompanions: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.companionsAllowed).toBe(10);
      expect(result.value.warnings.map((w) => w.code)).toContain('COMPANIONS_CLAMPED');
    }
  });

  it('rejects a negative or non-numeric companion count', () => {
    expect(validateImportRow(row({ companions: -1 })).ok).toBe(false);
    expect(validateImportRow(row({ companions: 'ثلاثة' })).ok).toBe(false);
  });

  it('collects every problem in one pass', () => {
    // The host fixes the row once, not once per round trip.
    const result = validateImportRow(row({ name: '', phone: 'abc', companions: -2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((i) => i.field).sort()).toEqual([
        'companions',
        'name',
        'phone',
      ]);
    }
  });

  it('parses section labels in both languages', () => {
    for (const [input, expected] of [
      ['رجال', 'MEN'],
      ['نساء', 'WOMEN'],
      ['Men', 'MEN'],
      ['female', 'WOMEN'],
      ['???', null],
    ] as const) {
      const result = validateImportRow(row({ section: input }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.section, `section=${input}`).toBe(expected);
    }
  });

  it('echoes the raw row back so it can be corrected inline', () => {
    const result = validateImportRow(row({ rowNumber: 47, phone: '123' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.rowNumber).toBe(47);
      expect(result.error.raw.name).toBe('أ. فيصل السبيعي');
    }
  });
});

describe('dedupeImportRows', () => {
  const valid = (rowNumber: number, phone: string, name = 'ضيف'): ValidImportRow => ({
    rowNumber,
    name,
    phone,
    companionsAllowed: 0,
    group: null,
    section: null,
    warnings: [],
  });

  it('keeps the first occurrence and reports the later one', () => {
    const result = dedupeImportRows(
      [valid(12, '+966554128830'), valid(47, '+966554128830'), valid(48, '+966501112233')],
      [],
    );

    expect(result.unique.map((r) => r.rowNumber)).toEqual([12, 48]);
    expect(result.duplicatesInFile).toHaveLength(1);
    expect(result.duplicatesInFile[0]!.rowNumber).toBe(47);
    // The design's error screen names the row it collided with: «مكرر مع الصف ١٢».
    expect(result.duplicatesInFile[0]!.issues[0]!.messageAr).toContain('12');
  });

  it('separates duplicates already in the database from duplicates in the file', () => {
    const result = dedupeImportRows(
      [valid(3, '+966554128830'), valid(4, '+966501112233')],
      ['+966554128830'],
    );

    expect(result.duplicatesExisting).toHaveLength(1);
    expect(result.duplicatesExisting[0]!.rowNumber).toBe(3);
    expect(result.duplicatesInFile).toHaveLength(0);
    expect(result.unique.map((r) => r.rowNumber)).toEqual([4]);
  });

  it('never emits a row in more than one bucket', () => {
    const rows = [valid(1, '+966554128830'), valid(2, '+966554128830'), valid(3, '+966501112233')];
    const result = dedupeImportRows(rows, ['+966501112233']);

    const total =
      result.unique.length + result.duplicatesInFile.length + result.duplicatesExisting.length;
    expect(total).toBe(rows.length);
  });

  it('handles an empty batch', () => {
    const result = dedupeImportRows([], ['+966554128830']);
    expect(result).toMatchObject({ unique: [], duplicatesInFile: [], duplicatesExisting: [] });
  });
});
