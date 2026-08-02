import { z } from 'zod';

export const importFieldSchema = z.enum(['name', 'phone', 'companions', 'group', 'section']);

/**
 * Column index per field. Null means "ignore this field" — the design's mapping
 * step offers «تجاهل هذا العمود» for columns the host doesn't want.
 */
export const columnMappingSchema = z.object({
  name: z.number().int().min(0).nullable(),
  phone: z.number().int().min(0).nullable(),
  companions: z.number().int().min(0).nullable().default(null),
  group: z.number().int().min(0).nullable().default(null),
  section: z.number().int().min(0).nullable().default(null),
});
export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;

/**
 * A row as the client holds it: the original cells, plus any inline corrections
 * the host made on the errors screen.
 *
 * Rows travel back to the server rather than being staged in a table. Guest
 * phone numbers are personal data, and not persisting an unconfirmed import is
 * simpler *and* leaves less lying around if a host abandons the wizard.
 */
export const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  cells: z.array(z.union([z.string(), z.number(), z.null()])).max(64),
});
export type ImportRowInput = z.infer<typeof importRowSchema>;

export const importOptionsSchema = z.object({
  /** The «اقبله» action on a +971 row. */
  allowForeignNumbers: z.boolean().default(true),
  /** Companion ceiling; higher values are clamped, not rejected. */
  maxCompanions: z.number().int().min(0).max(20).default(10),
});

export const importCommitSchema = z.object({
  mapping: columnMappingSchema,
  rows: z.array(importRowSchema).min(1, 'لا توجد صفوف للاستيراد').max(5000, 'حتى ٥٠٠٠ صف'),
  options: importOptionsSchema.default({ allowForeignNumbers: true, maxCompanions: 10 }),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

/** Dry run: identical payload, no writes. */
export const importValidateSchema = importCommitSchema;

export interface ParsedSheet {
  headers: string[];
  rows: ImportRowInput[];
  totalRows: number;
  /** True when the file had more rows than the parser accepted. */
  truncated: boolean;
}

export interface ImportReport {
  imported: number;
  /** Rows that failed validation outright. */
  invalid: number;
  /** Rows duplicating an earlier row in the same file. */
  duplicatesInFile: number;
  /** Rows whose phone already belongs to a guest of this event. */
  duplicatesExisting: number;
  /** How many numbers were rewritten to E.164 — the design surfaces this count. */
  reformattedPhones: number;
  foreignNumbers: number;
  totalRows: number;
}
