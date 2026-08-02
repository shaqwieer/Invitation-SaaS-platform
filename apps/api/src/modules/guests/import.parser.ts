import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { ImportRowInput, ParsedSheet } from '@da3wa/shared';
import { BadRequestError } from '../../lib/errors.js';

/** Matches the schema's cap, so parsing never produces a payload commit rejects. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_COLUMNS = 64;

type Cell = string | number | null;

/**
 * Flatten whatever ExcelJS hands back into a scalar.
 *
 * A cell is not always a primitive: formulas arrive as `{ result }`, styled text
 * as `{ richText: [...] }`, links as `{ text, hyperlink }`. Reading `.toString()`
 * on those yields "[object Object]", which then fails validation as a name.
 */
function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('');
  }
  if ('result' in obj) return toCell(obj.result);
  if ('text' in obj) return toCell(obj.text);
  if ('hyperlink' in obj) return toCell(obj.hyperlink);

  return null;
}

function isBlankRow(cells: Cell[]): boolean {
  return cells.every((c) => c === null || String(c).trim() === '');
}

function finalize(table: Cell[][]): ParsedSheet {
  // Drop leading blank rows so a spreadsheet with a decorative gap above the
  // header still maps correctly.
  while (table.length > 0 && isBlankRow(table[0]!)) table.shift();

  if (table.length === 0) {
    throw new BadRequestError('The file has no readable rows', 'IMPORT_EMPTY_FILE');
  }

  const headerRow = table[0]!;
  const headers = headerRow.slice(0, MAX_COLUMNS).map((c) => (c === null ? '' : String(c).trim()));

  const body = table.slice(1).filter((cells) => !isBlankRow(cells));
  const truncated = body.length > MAX_IMPORT_ROWS;

  const rows: ImportRowInput[] = body.slice(0, MAX_IMPORT_ROWS).map((cells, index) => ({
    // +2: one for the header row, one because spreadsheets are 1-based. This is
    // the number the host sees in Excel, which is the whole point of the report.
    rowNumber: index + 2,
    cells: cells.slice(0, MAX_COLUMNS),
  }));

  return { headers, rows, totalRows: body.length, truncated };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestError('The file could not be read as a spreadsheet', 'IMPORT_UNREADABLE');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestError('The workbook has no sheets', 'IMPORT_EMPTY_FILE');

  const table: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    // ExcelJS returns a 1-based array whose slot 0 is always empty.
    table.push(values.slice(1).map(toCell));
  });

  return finalize(table);
}

function parseCsv(buffer: Buffer): ParsedSheet {
  // Strip the BOM Excel writes on "CSV UTF-8" export — left in place it becomes
  // part of the first header, so "الاسم" stops matching.
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');

  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });

  if (result.data.length === 0) {
    throw new BadRequestError('The file has no readable rows', 'IMPORT_EMPTY_FILE');
  }

  return finalize(result.data.map((row) => row.map((cell) => (cell === '' ? null : cell))));
}

export async function parseGuestFile(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  if (buffer.length === 0) {
    throw new BadRequestError('The uploaded file is empty', 'IMPORT_EMPTY_FILE');
  }

  const extension = filename.toLowerCase().split('.').pop() ?? '';

  switch (extension) {
    case 'csv':
    case 'txt':
      return parseCsv(buffer);
    case 'xlsx':
    case 'xlsm':
      return parseXlsx(buffer);
    case 'xls':
      // The legacy binary format is a different container entirely; ExcelJS
      // cannot read it, and failing clearly beats failing confusingly.
      throw new BadRequestError(
        'Legacy .xls files are not supported — re-save as .xlsx or .csv',
        'IMPORT_LEGACY_XLS',
      );
    default:
      throw new BadRequestError('Upload an .xlsx or .csv file', 'IMPORT_UNSUPPORTED_TYPE');
  }
}
