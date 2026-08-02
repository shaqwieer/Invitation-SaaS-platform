import {
  dedupeImportRows,
  detectColumnMapping,
  validateImportRow,
  type ColumnMappingInput,
  type ImportCommitInput,
  type ImportReport,
  type ImportRowInput,
  type InvalidImportRow,
  type ParsedSheet,
  type ValidImportRow,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { ValidationError } from '../../lib/errors.js';
import { assertGuestCeiling, getGuestQuota, type GuestQuota } from '../../lib/quota.js';

export interface ImportPreview extends ParsedSheet {
  detectedMapping: ReturnType<typeof detectColumnMapping>;
  /** First few body rows, for the mapping screen's «عمود A · «أ. فيصل السبيعي»» hint. */
  sampleRows: ImportRowInput[];
}

export function buildPreview(sheet: ParsedSheet): ImportPreview {
  return {
    ...sheet,
    detectedMapping: detectColumnMapping(sheet.headers),
    sampleRows: sheet.rows.slice(0, 5),
  };
}

function cellAt(row: ImportRowInput, index: number | null): string | null {
  if (index === null) return null;
  const value = row.cells[index];
  return value === null || value === undefined ? null : String(value);
}

export interface ImportOutcome {
  report: ImportReport;
  /** Everything the errors screen renders: invalid rows and both duplicate kinds. */
  errors: InvalidImportRow[];
  /** Rows that would be (or were) created, with their warnings. */
  accepted: ValidImportRow[];
  /**
   * Package headroom after this import. Surfaced, never enforced here — the
   * design's confirm screen warns «سيتجاوز باقتك الحالية» and defers the upgrade
   * to send time.
   */
  quota: GuestQuota;
}

/**
 * Validate an import, and optionally apply it.
 *
 * `dryRun` powers the errors screen; the same function then commits, so what the
 * host reviewed is exactly what lands. Duplicate detection happens here in
 * application code rather than by catching the unique constraint: a constraint
 * violation aborts the whole statement and yields no per-row report, which is
 * precisely what «٦ صفوف تحتاج انتباهك» needs to show.
 */
export async function runImport(
  eventId: string,
  input: ImportCommitInput,
  actorId: string,
  { dryRun }: { dryRun: boolean },
): Promise<ImportOutcome> {
  const { mapping, rows, options } = input;
  assertMappingIsUsable(mapping);

  const valid: ValidImportRow[] = [];
  const invalid: InvalidImportRow[] = [];

  for (const row of rows) {
    const result = validateImportRow(
      {
        rowNumber: row.rowNumber,
        name: cellAt(row, mapping.name),
        phone: cellAt(row, mapping.phone),
        companions: cellAt(row, mapping.companions),
        group: cellAt(row, mapping.group),
        section: cellAt(row, mapping.section),
      },
      {
        defaultCountry: 'SA',
        maxCompanions: options.maxCompanions,
        allowForeignNumbers: options.allowForeignNumbers,
      },
    );

    if (result.ok) valid.push(result.value);
    else invalid.push(result.error);
  }

  // Only phones are needed, and only to build a Set — selecting whole rows for a
  // 5000-row import would pull far more than necessary.
  const existing = await prisma.guest.findMany({
    where: { eventId },
    select: { phone: true },
  });

  const deduped = dedupeImportRows(
    valid,
    existing.map((g) => g.phone),
  );

  let imported = 0;
  if (!dryRun && deduped.unique.length > 0) {
    await assertGuestCeiling(eventId, deduped.unique.length);

    const result = await prisma.guest.createMany({
      data: deduped.unique.map((row) => ({
        eventId,
        name: row.name,
        phone: row.phone,
        group: row.group,
        section: row.section,
        companionsAllowed: row.companionsAllowed,
      })),
      // Application-level dedupe already ran; this only absorbs a concurrent
      // import racing us, so one collision doesn't discard the whole batch.
      skipDuplicates: true,
    });

    imported = result.count;

    await audit({
      action: 'guest.import',
      actorId,
      eventId,
      meta: {
        imported,
        invalid: invalid.length,
        duplicatesInFile: deduped.duplicatesInFile.length,
        duplicatesExisting: deduped.duplicatesExisting.length,
        totalRows: rows.length,
      },
    });
  }

  const countWarning = (code: string) =>
    deduped.unique.filter((row) => row.warnings.some((w) => w.code === code)).length;

  return {
    report: {
      imported: dryRun ? 0 : imported,
      invalid: invalid.length,
      duplicatesInFile: deduped.duplicatesInFile.length,
      duplicatesExisting: deduped.duplicatesExisting.length,
      reformattedPhones: countWarning('PHONE_REFORMATTED'),
      foreignNumbers: countWarning('PHONE_FOREIGN'),
      totalRows: rows.length,
    },
    errors: [...invalid, ...deduped.duplicatesInFile, ...deduped.duplicatesExisting].sort(
      (a, b) => a.rowNumber - b.rowNumber,
    ),
    accepted: deduped.unique,
    quota: await getGuestQuota(eventId, dryRun ? deduped.unique.length : 0),
  };
}

/** Name and phone are the two columns without which there is nothing to create. */
function assertMappingIsUsable(mapping: ColumnMappingInput): void {
  const missing: Record<string, string[]> = {};
  if (mapping.name === null) missing.name = ['عيّن عمود الاسم'];
  if (mapping.phone === null) missing.phone = ['عيّن عمود رقم الجوال'];

  if (Object.keys(missing).length > 0) {
    throw new ValidationError({ formErrors: [], fieldErrors: missing });
  }
}
