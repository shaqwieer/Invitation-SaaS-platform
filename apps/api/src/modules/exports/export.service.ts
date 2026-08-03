import ExcelJS from 'exceljs';
import type { Event } from '@prisma/client';
import { guestExportName, seatsFor, type AttendanceReport } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';

const STATUS_AR: Record<string, string> = {
  NOT_SENT: 'لم تُرسل',
  SENT: 'أُرسلت',
  OPENED: 'فُتحت',
  CONFIRMED: 'مؤكّد',
  DECLINED: 'معتذر',
  ATTENDED: 'حضر فعليًا',
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0E5A45' },
};

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFF7F5EF' }, size: 11 };
  header.fill = HEADER_FILL;
  header.height = 24;
  header.alignment = { vertical: 'middle', horizontal: 'right' };
  // Header stays put while the host scrolls three hundred guests.
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
}

function sheetFor(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  // Arabic-first output: the sheet itself reads right-to-left, so column order
  // matches what the host sees in the app.
  return workbook.addWorksheet(name, { views: [{ rightToLeft: true }] });
}

function timestamp(value: Date | null | undefined, timezone: string): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  } catch {
    return value.toISOString();
  }
}

/**
 * The guest list.
 *
 * Phone numbers are written as text with an explicit `@` format. Excel
 * otherwise reads "+966554128830" as a formula or a number and silently
 * destroys it — the single most common way an exported contact list arrives
 * useless.
 */
export async function guestListWorkbook(event: Event): Promise<ExcelJS.Workbook> {
  const guests = await prisma.guest.findMany({
    where: { eventId: event.id },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      invitation: {
        select: { displayCode: true, sentAt: true, openedAt: true, respondedAt: true },
      },
      checkIns: { where: { revokedAt: null }, select: { seats: true, scannedAt: true } },
    },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'دعوة · Da3wa';
  workbook.created = new Date();

  const sheet = sheetFor(workbook, 'قائمة الضيوف');
  sheet.columns = [
    { header: 'الاسم', key: 'name', width: 28 },
    { header: 'رقم الجوال', key: 'phone', width: 18 },
    { header: 'المجموعة', key: 'group', width: 20 },
    { header: 'القسم', key: 'section', width: 10 },
    { header: 'المرافقون المسموح', key: 'allowed', width: 16 },
    { header: 'المرافقون المؤكدون', key: 'confirmed', width: 17 },
    { header: 'المقاعد', key: 'seats', width: 9 },
    { header: 'الحالة', key: 'status', width: 13 },
    { header: 'رمز الدخول', key: 'code', width: 13 },
    { header: 'أُرسلت', key: 'sentAt', width: 20 },
    { header: 'فُتحت', key: 'openedAt', width: 20 },
    { header: 'ردّ', key: 'respondedAt', width: 20 },
    { header: 'وقت الدخول', key: 'scannedAt', width: 20 },
    { header: 'ملاحظات', key: 'notes', width: 30 },
  ];

  for (const guest of guests) {
    const attending = guest.status === 'CONFIRMED' || guest.status === 'ATTENDED';
    sheet.addRow({
      // Blank, not «ضيفنا الكريم»: the host reads this to count people, and an
      // unclaimed delegated slot should look unclaimed at a glance.
      name: guestExportName(guest.name),
      phone: guest.phone ?? '',
      group: guest.group ?? '',
      section: guest.section === 'MEN' ? 'رجال' : guest.section === 'WOMEN' ? 'نساء' : '',
      allowed: guest.companionsAllowed,
      confirmed: attending ? guest.companionsConfirmed : '',
      seats: attending ? seatsFor(guest.companionsConfirmed) : '',
      status: STATUS_AR[guest.status] ?? guest.status,
      code: guest.invitation?.displayCode ?? '',
      sentAt: timestamp(guest.invitation?.sentAt, event.timezone),
      openedAt: timestamp(guest.invitation?.openedAt, event.timezone),
      respondedAt: timestamp(guest.invitation?.respondedAt, event.timezone),
      scannedAt: timestamp(guest.checkIns[0]?.scannedAt, event.timezone),
      notes: guest.notes ?? '',
    });
  }

  sheet.getColumn('phone').numFmt = '@';
  sheet.getColumn('phone').alignment = { horizontal: 'left' };
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
  styleHeader(sheet);

  return workbook;
}

/** The post-event report, one section per sheet so each stays readable. */
export async function attendanceWorkbook(
  event: Event,
  report: AttendanceReport,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'دعوة · Da3wa';
  workbook.created = new Date();

  const percent = (value: number | null) => (value === null ? '' : `${Math.round(value * 100)}٪`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = sheetFor(workbook, 'الملخص');
  summary.columns = [
    { header: 'البند', key: 'label', width: 30 },
    { header: 'القيمة', key: 'value', width: 22 },
  ];

  for (const [label, value] of [
    ['المناسبة', report.event.title],
    ['التاريخ', timestamp(event.startsAt, event.timezone)],
    ['المكان', report.event.venueName ?? ''],
    ['المدعوون', report.counts.invited],
    ['أكّدوا', report.counts.confirmed],
    ['اعتذروا', report.counts.declined],
    ['المقاعد المؤكدة', report.headline.confirmedSeats],
    ['الحضور الفعلي', report.headline.attendedSeats],
    ['نسبة الالتزام', percent(report.headline.complianceRate)],
    ['أكّدوا ولم يحضروا', report.counts.confirmedNoShow],
    ['المقاعد الشاغرة', report.counts.noShowSeats],
    [
      'أول دخول',
      report.timings.firstEntry
        ? timestamp(new Date(report.timings.firstEntry), event.timezone)
        : '',
    ],
    [
      'آخر دخول',
      report.timings.lastEntry ? timestamp(new Date(report.timings.lastEntry), event.timezone) : '',
    ],
  ] as Array<[string, string | number]>) {
    summary.addRow({ label, value });
  }
  styleHeader(summary);

  // ── Arrivals ───────────────────────────────────────────────────────────────
  const arrivals = sheetFor(workbook, 'توزيع الوصول');
  arrivals.columns = [
    { header: 'الوقت', key: 'at', width: 22 },
    { header: 'المقاعد', key: 'seats', width: 12 },
    { header: 'عمليات المسح', key: 'scans', width: 14 },
    { header: 'الذروة', key: 'peak', width: 10 },
  ];
  for (const row of report.arrivals) {
    arrivals.addRow({
      at: timestamp(new Date(row.at), event.timezone),
      seats: row.seats,
      scans: row.scans,
      peak: row.isPeak ? 'نعم' : '',
    });
  }
  styleHeader(arrivals);

  // ── By group ───────────────────────────────────────────────────────────────
  const groups = sheetFor(workbook, 'الحضور حسب المجموعة');
  groups.columns = [
    { header: 'المجموعة', key: 'group', width: 24 },
    { header: 'حضر', key: 'attended', width: 12 },
    { header: 'مؤكّد', key: 'confirmed', width: 12 },
    { header: 'النسبة', key: 'rate', width: 12 },
  ];
  for (const row of report.byGroup) {
    groups.addRow({
      group: row.group,
      attended: row.attendedSeats,
      confirmed: row.confirmedSeats,
      rate: percent(row.rate),
    });
  }
  styleHeader(groups);

  // ── No-shows ───────────────────────────────────────────────────────────────
  const noShows = sheetFor(workbook, 'أكّدوا ولم يحضروا');
  noShows.columns = [
    { header: 'الاسم', key: 'name', width: 28 },
    { header: 'المجموعة', key: 'group', width: 22 },
    { header: 'المقاعد', key: 'seats', width: 12 },
  ];
  for (const row of report.noShows) {
    noShows.addRow({ name: row.name, group: row.group ?? '', seats: row.seats });
  }
  styleHeader(noShows);

  return workbook;
}

/**
 * A filename that survives a Content-Disposition header.
 *
 * Arabic event titles are perfectly legal in a filename but not in a bare
 * `filename=` parameter, so the ASCII fallback is deliberately plain and the
 * real title travels in `filename*` (RFC 5987), which browsers prefer.
 */
export function contentDisposition(asciiName: string, utf8Name: string): string {
  const safe = asciiName.replace(/[^\w.-]+/g, '-');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}
