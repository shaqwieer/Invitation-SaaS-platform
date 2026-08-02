/**
 * Dashboard, report and exports.
 *
 * Built on one fixture with hand-computed totals, so every assertion is a real
 * number rather than a restatement of the query that produced it.
 *
 *   status      companions  seats   arrived
 *   CONFIRMED       3         4        —      group: عائلة العريس
 *   CONFIRMED       1         2        —      group: عائلة العروس
 *   ATTENDED        1         2        2      group: عائلة العريس
 *   ATTENDED        0         1        1      group: عائلة العروس
 *   DECLINED ×2
 *   SENT, OPENED                             (contacted, no answer)
 *   NOT_SENT ×2                              (never contacted)
 *
 *   confirmed seats  4 + 2 + 2 + 1 = 9
 *   attended seats           2 + 1 = 3
 *   contacted            10 − 2     = 8
 *   answered      2 + 2 + 2        = 6
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import type { Event as EventRow, GuestStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createEvent, createUser, loginAs, resetDb, type Session } from '../helpers/factories.js';

let app: Express;
let host: Session;
let intruder: Session;
let event: EventRow;

const GROOM = 'عائلة العريس';
const BRIDE = 'عائلة العروس';

let phoneCounter = 0;
const nextPhone = () => `+9665${String(20_000_000 + ++phoneCounter)}`;

async function addGuest(
  eventId: string,
  status: GuestStatus,
  companionsConfirmed: number,
  group: string | null,
  name: string,
) {
  return prisma.guest.create({
    data: {
      eventId,
      name,
      phone: nextPhone(),
      status,
      group,
      companionsAllowed: 3,
      companionsConfirmed,
    },
  });
}

/** A scanner session, so check-ins are attributable exactly as in production. */
async function scanner(eventId: string) {
  return prisma.scanUser.create({
    data: {
      eventId,
      displayName: 'سعود · بوابة الرجال',
      sessionTokenHash: `hash_${Math.random()}`,
    },
  });
}

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();
  const [a, b] = await Promise.all([createUser(), createUser()]);
  [host, intruder] = await Promise.all([loginAs(app, a), loginAs(app, b)]);
  event = await createEvent(a.id, { status: 'ACTIVE' });

  const [c1, c2, a1, a2] = await Promise.all([
    addGuest(event.id, 'CONFIRMED', 3, GROOM, 'أ. فيصل السبيعي'),
    addGuest(event.id, 'CONFIRMED', 1, BRIDE, 'م. نورة القحطاني'),
    addGuest(event.id, 'ATTENDED', 1, GROOM, 'هيا بنت طلال'),
    addGuest(event.id, 'ATTENDED', 0, BRIDE, 'عبدالله بن ماجد'),
  ]);

  await Promise.all([
    addGuest(event.id, 'DECLINED', 0, GROOM, 'عائلة الدوسري'),
    addGuest(event.id, 'DECLINED', 0, null, 'خالد بن عمر'),
    addGuest(event.id, 'SENT', 0, null, 'د. سلطان العتيبي'),
    addGuest(event.id, 'OPENED', 0, null, 'أ. جواهر المطيري'),
    addGuest(event.id, 'NOT_SENT', 0, null, 'أ. منيرة الشمري'),
    addGuest(event.id, 'NOT_SENT', 0, null, 'أ. أسماء العنزي'),
  ]);

  const door = await scanner(event.id);
  await prisma.checkIn.createMany({
    data: [
      {
        guestId: a1.id,
        eventId: event.id,
        seats: 2,
        scannedById: door.id,
        scannedAt: new Date('2026-11-20T18:05:00.000Z'),
      },
      {
        guestId: a2.id,
        eventId: event.id,
        seats: 1,
        scannedById: door.id,
        scannedAt: new Date('2026-11-20T18:40:00.000Z'),
      },
    ],
  });

  // Two confirmed guests never arrived — the no-show list.
  void c1;
  void c2;
});

describe('GET /dashboard', () => {
  it('counts every status', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    expect(res.status).toBe(200);
    expect(res.body.summary.counts).toMatchObject({
      total: 10,
      CONFIRMED: 2,
      ATTENDED: 2,
      DECLINED: 2,
      SENT: 1,
      OPENED: 1,
      NOT_SENT: 2,
    });
  });

  it('sums seats, not guests', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    // A confirmed guest occupies their own seat plus their companions'.
    expect(res.body.summary.seats.confirmed).toBe(9);
    expect(res.body.summary.seats.attended).toBe(3);
    // Everyone's full allowance, if all ten confirmed with three companions.
    expect(res.body.summary.seats.potential).toBe(40);
  });

  it('computes the three rates against the right denominators', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    const { rates } = res.body.summary;
    // Answered ÷ *contacted* — the two NOT_SENT guests were never asked.
    expect(rates.response).toBeCloseTo(6 / 8, 5);
    expect(rates.confirmation).toBeCloseTo(4 / 10, 5);
    expect(rates.attendance).toBeCloseTo(3 / 9, 5);
  });

  it('reports attendance as null before anyone arrives', async () => {
    await prisma.checkIn.deleteMany({ where: { eventId: event.id } });

    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    // "0% attended" on the morning of the wedding reads as a catastrophe;
    // "not yet" is the truth.
    expect(res.body.summary.rates.attendance).toBeNull();
  });

  it('survives an event with no guests at all', async () => {
    const empty = await createEvent(host.user.id);

    const res = await request(app)
      .get(`/api/events/${empty.id}/dashboard`)
      .set(...host.auth());

    expect(res.status).toBe(200);
    expect(res.body.summary.counts.total).toBe(0);
    // No NaNs anywhere — every rate has a zero denominator here.
    expect(JSON.stringify(res.body)).not.toContain('null,"confirmation":null');
    expect(res.body.summary.rates.response).toBe(0);
    expect(res.body.summary.rates.confirmation).toBe(0);
    expect(res.body.summary.averages.companionsPerConfirmedGuest).toBe(0);
  });

  it('averages companions across confirmed guests only', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    // (3 + 1 + 1 + 0) / 4
    expect(res.body.summary.averages.companionsPerConfirmedGuest).toBeCloseTo(1.25, 5);
  });

  it('counts guests contacted but still silent', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    // SENT and OPENED, with an invitation actually sent.
    expect(res.body.summary.awaitingReply.count).toBe(0);

    const silent = await prisma.guest.findFirstOrThrow({ where: { status: 'SENT' } });
    await prisma.invitation.create({
      data: {
        guestId: silent.id,
        eventId: event.id,
        token: 'awaitingtok1',
        displayCode: '9111-11',
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const after = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    expect(after.body.summary.awaitingReply.count).toBe(1);
    expect(after.body.summary.awaitingReply.oldestSentDaysAgo).toBe(3);
  });

  it('builds the activity feed from responses and check-ins', async () => {
    const guest = await prisma.guest.findFirstOrThrow({ where: { status: 'CONFIRMED' } });
    await prisma.rsvpResponse.create({
      data: { guestId: guest.id, eventId: event.id, attending: true, companions: 3 },
    });

    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    const kinds = res.body.summary.activity.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('CONFIRMED');
    expect(kinds).toContain('CHECKED_IN');

    const confirmed = res.body.summary.activity.find(
      (e: { kind: string }) => e.kind === 'CONFIRMED',
    );
    expect(confirmed.guestName).toBe(guest.name);
    expect(confirmed.count).toBe(3);
  });

  it('stamps its own freshness', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...host.auth());

    // The design shows «آخر تحديث قبل دقيقتين»; that must come from the server.
    expect(Date.parse(res.body.summary.updatedAt)).toBeGreaterThan(Date.now() - 10_000);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('GET /report', () => {
  it('leads with actual against confirmed', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    expect(res.status).toBe(200);
    expect(res.body.report.headline).toMatchObject({ attendedSeats: 3, confirmedSeats: 9 });
    expect(res.body.report.headline.complianceRate).toBeCloseTo(3 / 9, 5);
  });

  it('names the empty chairs', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    // Two confirmed guests never scanned: 4 seats + 2 seats.
    expect(res.body.report.counts.confirmedNoShow).toBe(2);
    expect(res.body.report.counts.noShowSeats).toBe(6);

    const names = res.body.report.noShows.map((n: { name: string }) => n.name);
    expect(names).toContain('أ. فيصل السبيعي');
    // Largest party first — that is the one worth chasing.
    expect(res.body.report.noShows[0].seats).toBe(4);
  });

  it('breaks attendance down by group', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    const groom = res.body.report.byGroup.find((g: { group: string }) => g.group === GROOM);
    const bride = res.body.report.byGroup.find((g: { group: string }) => g.group === BRIDE);

    expect(groom).toMatchObject({ confirmedSeats: 6, attendedSeats: 2 });
    expect(bride).toMatchObject({ confirmedSeats: 3, attendedSeats: 1 });
  });

  it('buckets arrivals by half hour and marks the peak', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    // 18:05 and 18:40 fall in different half-hour buckets.
    expect(res.body.report.arrivals).toHaveLength(2);
    expect(res.body.report.arrivals[0].seats).toBe(2);
    expect(res.body.report.arrivals[1].seats).toBe(1);
    expect(res.body.report.arrivals[0].isPeak).toBe(true);
    expect(res.body.report.arrivals[1].isPeak).toBe(false);
  });

  it('reports door timings', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    expect(res.body.report.timings.firstEntry).toBe('2026-11-20T18:05:00.000Z');
    expect(res.body.report.timings.lastEntry).toBe('2026-11-20T18:40:00.000Z');
    expect(res.body.report.timings.medianScanGapSeconds).toBe(35 * 60);
  });

  it('does not silently drop ungrouped guests', async () => {
    // Every guest must land in some bucket, or the group table stops adding up
    // to the totals printed above it.
    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    const total = res.body.report.byGroup.reduce(
      (sum: number, g: { confirmedSeats: number }) => sum + g.confirmedSeats,
      0,
    );
    expect(total).toBe(res.body.report.headline.confirmedSeats);
  });

  it('handles an event where nobody came', async () => {
    await prisma.checkIn.deleteMany({ where: { eventId: event.id } });

    const res = await request(app)
      .get(`/api/events/${event.id}/report`)
      .set(...host.auth());

    expect(res.body.report.headline.attendedSeats).toBe(0);
    expect(res.body.report.headline.complianceRate).toBe(0);
    expect(res.body.report.arrivals).toEqual([]);
    expect(res.body.report.timings.medianScanGapSeconds).toBeNull();
  });
});

describe('Excel exports', () => {
  async function loadWorkbook(path: string) {
    const res = await request(app)
      .get(path)
      .set(...host.auth())
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    // ExcelJS types `load` as taking a Buffer, but @types/node models the
    // supertest body as Buffer<ArrayBufferLike>; they are the same bytes.
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    return { res, workbook };
  }

  it('exports the guest list as a real workbook', async () => {
    const { res, workbook } = await loadWorkbook(`/api/events/${event.id}/exports/guests.xlsx`);

    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('attachment');

    const sheet = workbook.getWorksheet('قائمة الضيوف')!;
    expect(sheet).toBeDefined();
    // 10 guests plus the header row.
    expect(sheet.rowCount).toBe(11);
    expect(sheet.views[0]?.rightToLeft).toBe(true);
  });

  it('keeps phone numbers as text', async () => {
    const { workbook } = await loadWorkbook(`/api/events/${event.id}/exports/guests.xlsx`);
    const sheet = workbook.getWorksheet('قائمة الضيوف')!;

    // Excel reads "+9665…" as a formula or a number and destroys it — the most
    // common way an exported contact list arrives useless.
    const phone = sheet.getRow(2).getCell(2).value;
    expect(typeof phone).toBe('string');
    expect(String(phone).startsWith('+966')).toBe(true);
  });

  it('carries Arabic names and statuses through intact', async () => {
    const { workbook } = await loadWorkbook(`/api/events/${event.id}/exports/guests.xlsx`);
    const sheet = workbook.getWorksheet('قائمة الضيوف')!;

    const names: string[] = [];
    sheet.eachRow((row, index) => {
      if (index > 1) names.push(String(row.getCell(1).value));
    });

    expect(names).toContain('أ. فيصل السبيعي');
    expect(names).toContain('هيا بنت طلال');
  });

  it('exports the attendance report across sheets', async () => {
    const { workbook } = await loadWorkbook(`/api/events/${event.id}/exports/attendance.xlsx`);

    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'الملخص',
      'توزيع الوصول',
      'الحضور حسب المجموعة',
      'أكّدوا ولم يحضروا',
    ]);

    const summary = workbook.getWorksheet('الملخص')!;
    const values = summary.getColumn(2).values.map(String);
    expect(values).toContain('9'); // confirmed seats
    expect(values).toContain('3'); // attended seats
  });

  it('sends an ASCII-safe filename alongside the Arabic one', async () => {
    const { res } = await loadWorkbook(`/api/events/${event.id}/exports/guests.xlsx`);
    const disposition = res.headers['content-disposition'] as string;

    // An Arabic title is legal in a filename but not in a bare filename=
    // parameter, so the real one travels in filename* (RFC 5987).
    expect(disposition).toContain('filename="guests.xlsx"');
    expect(disposition).toContain("filename*=UTF-8''");
  });
});

describe('cross-tenant isolation', () => {
  it.each(['dashboard', 'report', 'exports/guests.xlsx', 'exports/attendance.xlsx'])(
    'refuses /%s for a different host',
    async (path) => {
      const res = await request(app)
        .get(`/api/events/${event.id}/${path}`)
        .set(...intruder.auth());

      expect(res.status).toBe(404);
    },
  );

  it('leaks no guest data in the refusal', async () => {
    const res = await request(app)
      .get(`/api/events/${event.id}/dashboard`)
      .set(...intruder.auth());

    expect(JSON.stringify(res.body)).not.toContain('فيصل');
  });

  it('requires authentication', async () => {
    await request(app).get(`/api/events/${event.id}/dashboard`).expect(401);
    await request(app).get(`/api/events/${event.id}/exports/guests.xlsx`).expect(401);
  });
});
