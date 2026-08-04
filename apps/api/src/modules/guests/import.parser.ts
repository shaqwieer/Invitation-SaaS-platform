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

/* ── vCard ──────────────────────────────────────────────────────────────────
 *
 * A phone's contact list, exported. This is the shortest path a host has from
 * «الأسماء عندي في جوالي» to a guest list — the alternative is retyping a few
 * hundred names into a spreadsheet, which is where an import feature stops
 * being used at all.
 *
 * The file is flattened into the same two-column table a spreadsheet would
 * have produced, under the headers the detector already knows, so everything
 * downstream — mapping, normalisation, the error screen — is untouched.
 *
 * WhatsApp is deliberately not mentioned anywhere near this: it exports chat
 * transcripts, not contacts, and there is no file it produces that belongs here.
 */

function isQuotedPrintable(line: string): boolean {
  const colon = line.indexOf(':');
  return (colon === -1 ? line : line.slice(0, colon)).toUpperCase().includes('QUOTED-PRINTABLE');
}

/**
 * One logical property per entry.
 *
 * Two unrelated mechanisms can split a property across physical lines, and a
 * file may use both:
 *
 *   folding      RFC 6350 §3.2 — the next line starts with a space or tab, and
 *                that space is the marker, not part of the value. Nothing is
 *                inserted on rejoin.
 *   soft break   vCard 2.1 — a quoted-printable value ends in `=` and runs on.
 *                This is what Android uses for the long Arabic names folding
 *                would never touch, so handling only the first finds half a name.
 */
function unfold(text: string): string[] {
  // CRLF is what phones actually write. Splitting on \n alone leaves a trailing
  // \r on every value, and a phone number ending in one fails normalisation —
  // which reads as a bad export rather than a bad parser.
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const out: string[] = [];

  for (const line of lines) {
    const previous = out.length > 0 ? out[out.length - 1]! : null;

    if (previous !== null && (line.startsWith(' ') || line.startsWith('\t'))) {
      out[out.length - 1] = previous + line.slice(1);
      continue;
    }

    if (previous !== null && previous.endsWith('=') && isQuotedPrintable(previous)) {
      out[out.length - 1] = previous.slice(0, -1) + line;
      continue;
    }

    out.push(line);
  }

  return out;
}

/**
 * vCard 2.1's own encoding, which Android still writes.
 *
 * Arabic names come out of it as `=D9=85=D8=AD=D9=85=D8=AF`, so skipping this
 * turns every Arabic contact from an Android export into mojibake. Soft line
 * breaks are already gone by the time a value reaches here — `unfold` owns
 * rejoining, whichever of the two mechanisms did the splitting.
 */
function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '=' && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(value.charCodeAt(i));
    }
  }

  return Buffer.from(bytes).toString('utf8');
}

interface VcardProperty {
  /** Upper-cased, with any `itemN.` group prefix stripped. */
  name: string;
  params: string[];
  value: string;
}

function parseProperty(line: string): VcardProperty | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;

  const [rawName, ...params] = line.slice(0, colon).split(';');
  // iOS writes grouped properties — `item1.TEL;type=pref:` — and a matcher that
  // does not strip the group finds no phone numbers at all in an iPhone export.
  const name = (rawName ?? '').replace(/^[^.]+\./, '').trim().toUpperCase();

  let value = line.slice(colon + 1);
  const upper = params.map((p) => p.toUpperCase());
  if (upper.some((p) => p.includes('QUOTED-PRINTABLE'))) value = decodeQuotedPrintable(value);

  return { name, params: upper, value: value.trim() };
}

/** `N:Last;First;Middle;Prefix;Suffix` — reassembled, not joined in file order. */
function nameFromStructured(value: string): string {
  const [last = '', first = '', middle = '', prefix = ''] = value.split(';');
  return [prefix, first, middle, last]
    .map((part) => part.replace(/\\,/g, ',').trim())
    .filter(Boolean)
    .join(' ');
}

/** Escaped commas and semicolons are literal text in a vCard value. */
function unescapeText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

function parseVcf(buffer: Buffer): ParsedSheet {
  const table: Cell[][] = [['الاسم', 'رقم الجوال']];

  let formatted = '';
  let structured = '';
  let phone: string | null = null;
  let preferredPhone: string | null = null;

  const flush = () => {
    const name = formatted || (structured ? nameFromStructured(structured) : '');
    // A contact with neither a name nor a number is a vCard artefact, not a
    // person. One with a name but no number is a person the host will want to
    // see listed as needing a number, so it goes through as an empty cell and
    // lands on the errors screen — the design's rule, not a silent drop.
    if (name || preferredPhone || phone) table.push([name, preferredPhone ?? phone]);

    formatted = '';
    structured = '';
    phone = null;
    preferredPhone = null;
  };

  for (const line of unfold(buffer.toString('utf8'))) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === 'END' && property.value.toUpperCase() === 'VCARD') {
      flush();
      continue;
    }

    switch (property.name) {
      case 'FN':
        formatted = unescapeText(property.value);
        break;
      case 'N':
        structured = property.value;
        break;
      case 'TEL': {
        const value = property.value.trim();
        if (!value) break;
        // A contact often carries home, work and mobile. The mobile is the one
        // an invitation can reach, so it wins wherever the export marks it.
        const mobile = property.params.some(
          (p) => p.includes('CELL') || p.includes('MOBILE') || p.includes('PREF'),
        );
        if (mobile) preferredPhone ??= value;
        else phone ??= value;
        break;
      }
      default:
        break;
    }
  }

  // A file whose last card is missing its END:VCARD still has one contact in it.
  flush();

  if (table.length === 1) {
    throw new BadRequestError('The file has no readable contacts', 'IMPORT_EMPTY_FILE');
  }

  return finalize(table);
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
    case 'vcf':
    case 'vcard':
      return parseVcf(buffer);
    case 'xls':
      // The legacy binary format is a different container entirely; ExcelJS
      // cannot read it, and failing clearly beats failing confusingly.
      throw new BadRequestError(
        'Legacy .xls files are not supported — re-save as .xlsx or .csv',
        'IMPORT_LEGACY_XLS',
      );
    default:
      throw new BadRequestError(
        'Upload an .xlsx, .csv or .vcf file',
        'IMPORT_UNSUPPORTED_TYPE',
      );
  }
}
