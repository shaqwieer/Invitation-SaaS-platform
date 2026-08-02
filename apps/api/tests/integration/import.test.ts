/**
 * Excel/CSV import.
 *
 * The governing rule, from the design: one bad row never fails the import.
 * «١٢٨ صفًا جاهز للاستيراد. صحّح ما يلي أو تجاهله.»
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  attachPackage,
  buildCsv,
  buildXlsx,
  createEvent,
  createGuest,
  createUser,
  loginAs,
  resetDb,
  type Session,
} from '../helpers/factories.js';

let app: Express;
let hostA: Session;
let hostB: Session;
let eventA: EventRow;
let eventB: EventRow;

const HEADERS = ['الاسم الكامل', 'الجوال', 'عدد الأفراد', 'ملاحظات'];

const SAMPLE = [
  HEADERS,
  ['أ. فيصل السبيعي', '0554128830', 3, 'عائلة العريس'],
  ['م. نورة القحطاني', '966507331120', 1, 'صديقات العروس'],
  ['عائلة الدوسري', '+966539904471', null, 'جيران'],
];

beforeAll(() => {
  // fileImport's real budget is 30 per 15 minutes; this file issues more than
  // that between its cases, so it is raised here and asserted separately below.
  app = createApp({
    rateLimits: {
      auth: { windowMs: 60_000, limit: 500 },
      fileImport: { windowMs: 60_000, limit: 500 },
    },
  });
});

beforeEach(async () => {
  await resetDb();
  const [a, b] = await Promise.all([createUser(), createUser()]);
  [hostA, hostB] = await Promise.all([loginAs(app, a), loginAs(app, b)]);
  [eventA, eventB] = await Promise.all([createEvent(a.id), createEvent(b.id)]);
});

const url = (eventId: string, step: string) => `/api/events/${eventId}/guests/import/${step}`;

/** Standard mapping for the sample sheet above. */
const MAPPING = { name: 0, phone: 1, companions: 2, group: 3, section: null };

async function parse(eventId: string, session: Session, buffer: Buffer, filename: string) {
  return request(app)
    .post(url(eventId, 'parse'))
    .set(...session.auth())
    .attach('file', buffer, filename);
}

describe('step 1 — parse', () => {
  it('reads an .xlsx and auto-detects the columns', async () => {
    const res = await parse(eventA.id, hostA, await buildXlsx(SAMPLE), 'guests-family.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(HEADERS);
    expect(res.body.totalRows).toBe(3);
    expect(res.body.detectedMapping.columns).toMatchObject({ name: 0, phone: 1, companions: 2 });
  });

  it('reads a .csv', async () => {
    const res = await parse(eventA.id, hostA, buildCsv(SAMPLE), 'guests.csv');

    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(HEADERS);
    expect(res.body.rows).toHaveLength(3);
  });

  it('strips the BOM Excel writes on "CSV UTF-8" export', async () => {
    // Left in place the BOM becomes part of the first header, and «الاسم» stops
    // matching — a failure that looks like broken column detection.
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buildCsv(SAMPLE)]);
    const res = await parse(eventA.id, hostA, withBom, 'guests.csv');

    expect(res.body.headers[0]).toBe('الاسم الكامل');
    expect(res.body.detectedMapping.columns.name).toBe(0);
  });

  it('numbers rows the way the spreadsheet does', async () => {
    const res = await parse(eventA.id, hostA, buildCsv(SAMPLE), 'guests.csv');
    // Row 1 is the header, so the first guest is row 2 — the number the host
    // sees in Excel, which is what the error report has to cite.
    expect(res.body.rows[0].rowNumber).toBe(2);
  });

  it('skips blank rows', async () => {
    const withGaps = [HEADERS, ['ضيف', '0554128830', null, null], ['', '', '', ''], []];
    const res = await parse(eventA.id, hostA, await buildXlsx(withGaps), 'g.xlsx');
    expect(res.body.totalRows).toBe(1);
  });

  it.each([
    ['guests.xls', 'IMPORT_LEGACY_XLS'],
    ['guests.pdf', 'IMPORT_UNSUPPORTED_TYPE'],
  ])('rejects %s clearly', async (filename, code) => {
    const res = await parse(eventA.id, hostA, buildCsv(SAMPLE), filename);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('rejects an empty upload', async () => {
    const res = await parse(eventA.id, hostA, Buffer.from(''), 'guests.csv');
    expect(res.status).toBe(400);
  });

  it('requires a file', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'parse'))
      .set(...hostA.auth());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMPORT_NO_FILE');
  });
});

describe('step 2–3 — validate (dry run)', () => {
  const rows = [
    { rowNumber: 2, cells: ['أ. فيصل السبيعي', '0554128830', 3, 'عائلة العريس'] },
    { rowNumber: 14, cells: ['سارة الحربي', '05012345', 1, null] }, // short number
    { rowNumber: 29, cells: ['', '+966552201188', null, null] }, // missing name
    { rowNumber: 47, cells: ['أ. فيصل السبيعي', '0554128830', 3, null] }, // dup of row 2
    { rowNumber: 91, cells: ['خالد بن عمر', '+971501182233', 2, null] }, // foreign
  ];

  it('reproduces the design’s error screen', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows });

    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({
      imported: 0,
      invalid: 2,
      duplicatesInFile: 1,
      duplicatesExisting: 0,
      totalRows: 5,
    });

    const cited = res.body.errors.map((e: { rowNumber: number }) => e.rowNumber);
    expect(cited).toEqual([14, 29, 47]);
  });

  it('writes nothing on a dry run', async () => {
    await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows })
      .expect(200);

    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('counts the numbers it reformatted', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows });

    // Drives «وحّدنا صيغة ٨٣ رقمًا تلقائيًا إلى ‎+966».
    expect(res.body.report.reformattedPhones).toBeGreaterThan(0);
    expect(res.body.report.foreignNumbers).toBe(1);
  });

  it('names the row a duplicate collided with', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows });

    const dup = res.body.errors.find((e: { rowNumber: number }) => e.rowNumber === 47);
    expect(dup.issues[0].code).toBe('DUPLICATE_IN_FILE');
    expect(dup.issues[0].messageAr).toContain('2');
  });

  it('flags rows whose number is already a guest of this event', async () => {
    await createGuest(eventA.id, { phone: '+966554128830' });

    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows: [rows[0]!] });

    expect(res.body.report.duplicatesExisting).toBe(1);
    expect(res.body.errors[0].issues[0].code).toBe('DUPLICATE_EXISTING');
  });

  it('rejects a foreign number when the host declines it', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({
        mapping: MAPPING,
        rows: [{ rowNumber: 91, cells: ['خالد', '+971501182233', 2, null] }],
        options: { allowForeignNumbers: false, maxCompanions: 10 },
      });

    expect(res.body.report.invalid).toBe(1);
  });

  it('requires the name and phone columns to be mapped', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'validate'))
      .set(...hostA.auth())
      .send({ mapping: { ...MAPPING, phone: null }, rows });

    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.phone).toBeDefined();
  });
});

describe('step 4 — commit', () => {
  it('imports the good rows and reports the rest', async () => {
    const rows = [
      { rowNumber: 2, cells: ['أ. فيصل السبيعي', '0554128830', 3, 'عائلة العريس'] },
      { rowNumber: 3, cells: ['م. نورة القحطاني', '966507331120', 1, 'صديقات العروس'] },
      { rowNumber: 14, cells: ['سارة الحربي', '05012345', 1, null] },
      { rowNumber: 47, cells: ['أ. فيصل السبيعي', '0554128830', 3, null] },
    ];

    const res = await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send({ mapping: MAPPING, rows });

    expect(res.status).toBe(201);
    expect(res.body.report).toMatchObject({ imported: 2, invalid: 1, duplicatesInFile: 1 });

    const stored = await prisma.guest.findMany({
      where: { eventId: eventA.id },
      orderBy: { phone: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(stored.map((g) => g.phone)).toEqual(['+966507331120', '+966554128830']);
  });

  it('carries companions and group through to the stored guest', async () => {
    await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send({
        mapping: MAPPING,
        rows: [{ rowNumber: 2, cells: ['أ. فيصل السبيعي', '0554128830', '٣', 'عائلة العريس'] }],
      })
      .expect(201);

    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: eventA.id } });
    expect(guest.companionsAllowed).toBe(3);
    expect(guest.group).toBe('عائلة العريس');
    expect(guest.status).toBe('NOT_SENT');
  });

  it('imports nothing when every row is bad, and still returns a report', async () => {
    const res = await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send({
        mapping: MAPPING,
        rows: [
          { rowNumber: 2, cells: ['', 'nonsense', null, null] },
          { rowNumber: 3, cells: ['', '', null, null] },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.report.imported).toBe(0);
    expect(res.body.report.invalid).toBe(2);
    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('is safe to run twice — the second pass adds nobody', async () => {
    const payload = {
      mapping: MAPPING,
      rows: [{ rowNumber: 2, cells: ['أ. فيصل السبيعي', '0554128830', 3, null] }],
    };

    await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send(payload)
      .expect(201);

    const second = await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send(payload);

    expect(second.body.report.imported).toBe(0);
    expect(second.body.report.duplicatesExisting).toBe(1);
    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(1);
  });

  it('warns when the list outgrows the package but still imports', async () => {
    await attachPackage(eventA.id, 2);

    const res = await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostA.auth())
      .send({
        mapping: MAPPING,
        rows: [
          { rowNumber: 2, cells: ['ضيف ١', '0554128831', null, null] },
          { rowNumber: 3, cells: ['ضيف ٢', '0554128832', null, null] },
          { rowNumber: 4, cells: ['ضيف ٣', '0554128833', null, null] },
        ],
      });

    // The design's confirm screen says the upgrade is demanded at *send* time —
    // «ستُطلب ترقية عند الإرسال» — so a host on the wrong package can still
    // assemble their list.
    expect(res.status).toBe(201);
    expect(res.body.report.imported).toBe(3);
    expect(res.body.quota).toMatchObject({ cap: 2, used: 3, exceeded: true });
  });
});

describe('rate limiting', () => {
  it('gives imports their own budget, tighter than the general one', async () => {
    const strict = createApp({
      rateLimits: {
        auth: { windowMs: 60_000, limit: 500 },
        fileImport: { windowMs: 60_000, limit: 2 },
        general: { windowMs: 60_000, limit: 500 },
      },
    });

    const host = await createUser();
    const session = await loginAs(strict, host);
    const event = await createEvent(host.id);

    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await request(strict)
        .post(url(event.id, 'parse'))
        .set(...session.auth())
        .attach('file', buildCsv(SAMPLE), 'g.csv');
      expect(res.status, `attempt ${attempt}`).toBe(200);
    }

    // Parsing a 10 MB workbook is the most expensive thing an authenticated
    // host can ask for; it must not ride on the read-sized general budget.
    const blocked = await request(strict)
      .post(url(event.id, 'parse'))
      .set(...session.auth())
      .attach('file', buildCsv(SAMPLE), 'g.csv');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('IMPORT_RATE_LIMITED');
  });
});

describe('cross-tenant isolation on import routes', () => {
  it.each(['parse', 'validate', 'commit'])('refuses %s on another host’s event', async (step) => {
    const req = request(app)
      .post(url(eventA.id, step))
      .set(...hostB.auth());

    const res =
      step === 'parse'
        ? await req.attach('file', buildCsv(SAMPLE), 'g.csv')
        : await req.send({
            mapping: MAPPING,
            rows: [{ rowNumber: 2, cells: ['دخيل', '0554128830', null, null] }],
          });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });

  it('writes nothing into the target event on a refused commit', async () => {
    await request(app)
      .post(url(eventA.id, 'commit'))
      .set(...hostB.auth())
      .send({
        mapping: MAPPING,
        rows: [{ rowNumber: 2, cells: ['دخيل', '0554128830', null, null] }],
      })
      .expect(404);

    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('does not let host B import into their own event using host A’s id in the body', async () => {
    // eventId comes from the URL, never the payload — there is no body field
    // that could redirect the write.
    const res = await request(app)
      .post(url(eventB.id, 'commit'))
      .set(...hostB.auth())
      .send({
        mapping: MAPPING,
        rows: [{ rowNumber: 2, cells: ['ضيف', '0554128830', null, null] }],
        eventId: eventA.id,
      });

    expect(res.status).toBe(201);
    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(0);
    expect(await prisma.guest.count({ where: { eventId: eventB.id } })).toBe(1);
  });
});
