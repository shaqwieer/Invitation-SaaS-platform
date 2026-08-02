/**
 * Guest-list import: column detection and per-row validation.
 *
 * Pure — no database, no I/O — so the same code runs in the API and could drive
 * a client-side preview. The database-dependent half (duplicate detection
 * against rows that already exist, quota checks) lives in the API.
 *
 * Guiding rule from the design: **one bad row must never fail the import.**
 * Every row is judged independently and the good ones always land.
 */
import { matchKey } from './arabic.js';
import { normalizePhone, type CountryCode, type PhoneErrorReason } from './phone.js';
import { toWesternDigits } from './digits.js';

export type ImportField = 'name' | 'phone' | 'companions' | 'group' | 'section';

export const IMPORT_FIELDS: ImportField[] = ['name', 'phone', 'companions', 'group', 'section'];
export const REQUIRED_IMPORT_FIELDS: ImportField[] = ['name', 'phone'];

/**
 * Header aliases, most-specific first.
 *
 * Order matters: «رقم الجوال» must win over «رقم» alone, or a sheet with both
 * "رقم" (a row number) and "رقم الجوال" maps the wrong column.
 */
const ALIASES: Record<ImportField, string[]> = {
  name: [
    'اسم الضيف',
    'الاسم الكامل',
    'الاسم كامل',
    'اسم كامل',
    'الاسم',
    'اسم',
    'guest name',
    'full name',
    'fullname',
    'name',
    'guest',
  ],
  phone: [
    'رقم الجوال',
    'رقم الهاتف',
    'رقم الموبايل',
    'رقم التواصل',
    'الجوال',
    'الهاتف',
    'الموبايل',
    'جوال',
    'هاتف',
    'phone number',
    'mobile number',
    'whatsapp',
    'phone',
    'mobile',
    'tel',
    'number',
  ],
  companions: [
    'عدد المرافقين',
    'عدد الافراد',
    'عدد الاشخاص',
    'عدد المقاعد',
    'المرافقين',
    'المرافقون',
    'مرافقين',
    'الافراد',
    'companions',
    'plus ones',
    'seats',
    'accompanying',
    'count',
  ],
  group: [
    'المجموعة',
    'التصنيف',
    'العائله',
    'الجهه',
    'ملاحظات',
    'مجموعه',
    'group',
    'category',
    'family',
    'side',
    'tag',
    'notes',
  ],
  section: ['القسم', 'قسم', 'رجال نساء', 'section', 'gender'],
};

export type MappingConfidence = 'auto' | 'review' | 'none';

export interface ColumnMapping {
  /** Column index per field; null when unmapped. */
  columns: Record<ImportField, number | null>;
  /**
   * 'auto'   — an exact alias match, safe to use unreviewed
   * 'review' — a fuzzy (contains) match; the design marks these «راجع الاختيار»
   * 'none'   — nothing matched
   */
  confidence: Record<ImportField, MappingConfidence>;
}

export function detectColumnMapping(headers: string[]): ColumnMapping {
  const keys = headers.map((h) => matchKey(h ?? ''));

  const columns = {} as Record<ImportField, number | null>;
  const confidence = {} as Record<ImportField, MappingConfidence>;
  const taken = new Set<number>();

  // Exact matches first, across all fields, so a fuzzy hit can never steal a
  // column that some other field matches exactly.
  for (const field of IMPORT_FIELDS) {
    columns[field] = null;
    confidence[field] = 'none';

    for (const alias of ALIASES[field]) {
      const index = keys.findIndex((key, i) => key === alias && !taken.has(i));
      if (index !== -1) {
        columns[field] = index;
        confidence[field] = 'auto';
        taken.add(index);
        break;
      }
    }
  }

  for (const field of IMPORT_FIELDS) {
    if (columns[field] !== null) continue;

    for (const alias of ALIASES[field]) {
      // Ignore very short aliases when matching loosely — "اسم" inside another
      // word produces nonsense pairings.
      if (alias.length < 4) continue;
      const index = keys.findIndex(
        (key, i) => !taken.has(i) && key.length > 0 && (key.includes(alias) || alias.includes(key)),
      );
      if (index !== -1) {
        columns[field] = index;
        confidence[field] = 'review';
        taken.add(index);
        break;
      }
    }
  }

  return { columns, confidence };
}

// ─── Row validation ──────────────────────────────────────────────────────────

export type ImportIssueCode =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'PHONE_REQUIRED'
  | 'PHONE_TOO_SHORT'
  | 'PHONE_TOO_LONG'
  | 'PHONE_NOT_MOBILE'
  | 'PHONE_INVALID'
  | 'PHONE_UNSUPPORTED_COUNTRY'
  | 'COMPANIONS_NOT_A_NUMBER'
  | 'COMPANIONS_NEGATIVE'
  | 'COMPANIONS_TOO_MANY'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_EXISTING';

export type ImportWarningCode = 'PHONE_REFORMATTED' | 'PHONE_FOREIGN' | 'COMPANIONS_CLAMPED';

export interface ImportIssue {
  code: ImportIssueCode;
  field: ImportField;
  messageAr: string;
  messageEn: string;
}

export interface ImportWarning {
  code: ImportWarningCode;
  field: ImportField;
  messageAr: string;
  messageEn: string;
}

const PHONE_ISSUES: Record<PhoneErrorReason, ImportIssue> = {
  EMPTY: {
    code: 'PHONE_REQUIRED',
    field: 'phone',
    messageAr: 'رقم الجوال مطلوب',
    messageEn: 'Phone number is required',
  },
  TOO_SHORT: {
    code: 'PHONE_TOO_SHORT',
    field: 'phone',
    messageAr: 'رقم ناقص — يحتاج ١٠ أرقام',
    messageEn: 'Number is too short — 10 digits required',
  },
  TOO_LONG: {
    code: 'PHONE_TOO_LONG',
    field: 'phone',
    messageAr: 'الرقم أطول من المسموح',
    messageEn: 'Number is too long',
  },
  NOT_A_MOBILE: {
    code: 'PHONE_NOT_MOBILE',
    field: 'phone',
    messageAr: 'الرقم يجب أن يبدأ بـ 05',
    messageEn: 'Number must be a mobile',
  },
  INVALID_CHARACTERS: {
    code: 'PHONE_INVALID',
    field: 'phone',
    messageAr: 'الرقم يحتوي على رموز غير مسموحة',
    messageEn: 'Number contains invalid characters',
  },
  UNSUPPORTED_COUNTRY: {
    code: 'PHONE_UNSUPPORTED_COUNTRY',
    field: 'phone',
    messageAr: 'الدولة غير مدعومة حاليًا',
    messageEn: 'Country is not supported yet',
  },
};

export interface RawImportRow {
  /** 1-based row number in the source file, for the error report. */
  rowNumber: number;
  name?: string | null;
  phone?: string | null;
  companions?: string | number | null;
  group?: string | null;
  section?: string | null;
}

export interface ValidImportRow {
  rowNumber: number;
  name: string;
  phone: string;
  companionsAllowed: number;
  group: string | null;
  section: 'MEN' | 'WOMEN' | null;
  warnings: ImportWarning[];
}

export interface InvalidImportRow {
  rowNumber: number;
  /** Echoed back so the client can render the row for inline correction. */
  raw: RawImportRow;
  issues: ImportIssue[];
}

export interface ValidateRowOptions {
  defaultCountry?: CountryCode;
  /** Upper bound on companions; values above are clamped with a warning. */
  maxCompanions?: number;
  /**
   * Accept numbers outside the default country. The design's error screen offers
   * «اقبله» per row, so this is a decision the host makes, not a hard rule.
   */
  allowForeignNumbers?: boolean;
}

function parseSection(value: string | null | undefined): 'MEN' | 'WOMEN' | null {
  if (!value) return null;
  const key = matchKey(value);
  if (['رجال', 'رجل', 'شباب', 'men', 'male', 'm'].includes(key)) return 'MEN';
  if (['نساء', 'نسا', 'سيدات', 'women', 'female', 'f'].includes(key)) return 'WOMEN';
  return null;
}

/** Validate one row in isolation. Cross-row duplicate detection happens later. */
export function validateImportRow(
  row: RawImportRow,
  options: ValidateRowOptions = {},
): { ok: true; value: ValidImportRow } | { ok: false; error: InvalidImportRow } {
  const { defaultCountry = 'SA', maxCompanions = 20, allowForeignNumbers = true } = options;

  const issues: ImportIssue[] = [];
  const warnings: ImportWarning[] = [];

  const name = String(row.name ?? '').trim();
  if (name.length === 0) {
    issues.push({
      code: 'NAME_REQUIRED',
      field: 'name',
      messageAr: 'خانة الاسم فارغة',
      messageEn: 'Name is empty',
    });
  } else if (name.length > 120) {
    issues.push({
      code: 'NAME_TOO_LONG',
      field: 'name',
      messageAr: 'الاسم طويل جدًا',
      messageEn: 'Name is too long',
    });
  }

  let phone = '';
  const rawPhone = String(row.phone ?? '').trim();
  if (rawPhone.length === 0) {
    issues.push(PHONE_ISSUES.EMPTY);
  } else {
    const result = normalizePhone(rawPhone, defaultCountry);
    if (!result.ok) {
      issues.push(PHONE_ISSUES[result.reason]);
    } else if (!result.isDefaultCountry && !allowForeignNumbers) {
      issues.push({
        code: 'PHONE_UNSUPPORTED_COUNTRY',
        field: 'phone',
        messageAr: 'رقم خارج السعودية',
        messageEn: 'Number is outside Saudi Arabia',
      });
    } else {
      phone = result.e164;
      if (result.wasReformatted) {
        warnings.push({
          code: 'PHONE_REFORMATTED',
          field: 'phone',
          messageAr: 'وُحّدت صيغة الرقم إلى ‎+966',
          messageEn: 'Number reformatted to E.164',
        });
      }
      if (!result.isDefaultCountry) {
        warnings.push({
          code: 'PHONE_FOREIGN',
          field: 'phone',
          messageAr: 'رقم خارج السعودية',
          messageEn: 'Number is outside Saudi Arabia',
        });
      }
    }
  }

  // Blank means "no companions", not "invalid" — most sheets leave it empty.
  let companionsAllowed = 0;
  const rawCompanions = row.companions;
  if (
    rawCompanions !== null &&
    rawCompanions !== undefined &&
    String(rawCompanions).trim() !== ''
  ) {
    const parsed = Number(toWesternDigits(String(rawCompanions).trim()));

    if (!Number.isFinite(parsed)) {
      issues.push({
        code: 'COMPANIONS_NOT_A_NUMBER',
        field: 'companions',
        messageAr: 'عدد المرافقين يجب أن يكون رقمًا',
        messageEn: 'Companions must be a number',
      });
    } else if (parsed < 0) {
      issues.push({
        code: 'COMPANIONS_NEGATIVE',
        field: 'companions',
        messageAr: 'عدد المرافقين لا يمكن أن يكون سالبًا',
        messageEn: 'Companions cannot be negative',
      });
    } else if (parsed > maxCompanions) {
      // Clamp rather than reject: a 99 in this column is a typo, and losing the
      // whole guest over it helps nobody.
      companionsAllowed = maxCompanions;
      warnings.push({
        code: 'COMPANIONS_CLAMPED',
        field: 'companions',
        messageAr: `خُفّض عدد المرافقين إلى ${maxCompanions}`,
        messageEn: `Companions capped at ${maxCompanions}`,
      });
    } else {
      companionsAllowed = Math.floor(parsed);
    }
  }

  if (issues.length > 0) {
    return { ok: false, error: { rowNumber: row.rowNumber, raw: row, issues } };
  }

  const group = String(row.group ?? '').trim();

  return {
    ok: true,
    value: {
      rowNumber: row.rowNumber,
      name,
      phone,
      companionsAllowed,
      group: group.length > 0 ? group.slice(0, 80) : null,
      section: parseSection(row.section),
      warnings,
    },
  };
}

// ─── Batch duplicate detection ───────────────────────────────────────────────

export interface DedupeResult {
  /** Rows that survived: first occurrence of each phone, not already in the DB. */
  unique: ValidImportRow[];
  /** Later occurrences of a phone already seen earlier in the same file. */
  duplicatesInFile: InvalidImportRow[];
  /** Rows whose phone already belongs to a guest of this event. */
  duplicatesExisting: InvalidImportRow[];
}

/**
 * Split validated rows into keepers and duplicates.
 *
 * Detection happens here, before any insert. Leaning on the
 * `@@unique([eventId, phone])` constraint instead would abort the transaction on
 * the first collision and produce no per-row report — which is precisely what
 * the design's «٦ صفوف تحتاج انتباهك» screen must be able to show.
 *
 * @param existingPhones E.164 numbers already attached to this event.
 */
export function dedupeImportRows(
  rows: ValidImportRow[],
  existingPhones: Iterable<string>,
): DedupeResult {
  const existing = new Set(existingPhones);
  const seen = new Map<string, number>();

  const unique: ValidImportRow[] = [];
  const duplicatesInFile: InvalidImportRow[] = [];
  const duplicatesExisting: InvalidImportRow[] = [];

  for (const row of rows) {
    if (existing.has(row.phone)) {
      duplicatesExisting.push({
        rowNumber: row.rowNumber,
        raw: { rowNumber: row.rowNumber, name: row.name, phone: row.phone },
        issues: [
          {
            code: 'DUPLICATE_EXISTING',
            field: 'phone',
            messageAr: 'هذا الرقم مضاف مسبقًا لهذه المناسبة',
            messageEn: 'This number is already a guest of this event',
          },
        ],
      });
      continue;
    }

    const firstSeenAt = seen.get(row.phone);
    if (firstSeenAt !== undefined) {
      duplicatesInFile.push({
        rowNumber: row.rowNumber,
        raw: { rowNumber: row.rowNumber, name: row.name, phone: row.phone },
        issues: [
          {
            code: 'DUPLICATE_IN_FILE',
            field: 'phone',
            messageAr: `مكرر مع الصف ${firstSeenAt}`,
            messageEn: `Duplicate of row ${firstSeenAt}`,
          },
        ],
      });
      continue;
    }

    seen.set(row.phone, row.rowNumber);
    unique.push(row);
  }

  return { unique, duplicatesInFile, duplicatesExisting };
}
