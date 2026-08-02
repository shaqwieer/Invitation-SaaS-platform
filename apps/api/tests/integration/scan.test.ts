/**
 * The door.
 *
 * The governing decision, confirmed before implementation: a second scan is
 * **rejected and writes nothing**, and admitting anyway is a separate, audited
 * override attributed to the person who decided. These tests hold both halves.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { hash as argonHash } from '@node-rs/argon2';
import type { Event as EventRow, Guest } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signQrToken } from '../../src/lib/qr.js';
import {
  createEvent,
  createGuest,
  createUser,
  loginAs,
  resetDb,
  type Session,
} from '../helpers/factories.js';

const DOOR_PASSWORD = 'door1234';

let app: Express;
let host: Session;
let event: EventRow;
let guest: Guest;
let invitationId: string;
let scanSession: string;

/** A confirmed guest with an invitation — the only shape the door ever admits. */
async function confirmedGuest(
  eventId: string,
  overrides: Partial<Pick<Guest, 'name' | 'phone' | 'companionsConfirmed' | 'status'>> = {},
) {
  const created = await createGuest(eventId, {
    name: overrides.name ?? 'أ. فيصل السبيعي',
    phone: overrides.phone ?? `+9665${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    status: overrides.status ?? 'CONFIRMED',
  });

  await prisma.guest.update({
    where: { id: created.id },
    data: { companionsConfirmed: overrides.companionsConfirmed ?? 3 },
  });

  const invitation = await prisma.invitation.create({
    data: {
      guestId: created.id,
      eventId,
      token: `t${Math.random().toString(36).slice(2, 13)}`,
      displayCode: `${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(10 + Math.random() * 89)}`,
      sentAt: new Date(),
      respondedAt: new Date(),
      qrIssuedAt: new Date(),
    },
  });

  return {
    guest: await prisma.guest.findUniqueOrThrow({ where: { id: created.id } }),
    invitation,
    qr: signQrToken({ eventId, invitationId: invitation.id, issuedAt: new Date() }),
  };
}

async function openDoor(eventId: string, displayName = 'سعود · بوابة الرجال') {
  const res = await request(app)
    .post(`/api/scan/gate/${eventId}`)
    .send({ password: DOOR_PASSWORD, displayName });

  if (res.status !== 201) throw new Error(`gate failed (${res.status})`);
  return res.body.sessionToken as string;
}

const door = (session: string) => ({ 'X-Scan-Session': session });

beforeAll(() => {
  app = createApp({
    rateLimits: {
      auth: { windowMs: 60_000, limit: 500 },
      scanGate: { windowMs: 60_000, limit: 500 },
    },
  });
});

beforeEach(async () => {
  await resetDb();
  const user = await createUser();
  host = await loginAs(app, user);
  event = await createEvent(user.id, { status: 'ACTIVE' });
  await prisma.event.update({
    where: { id: event.id },
    data: { scannerPasswordHash: await argonHash(DOOR_PASSWORD) },
  });

  const fixture = await confirmedGuest(event.id);
  guest = fixture.guest;
  invitationId = fixture.invitation.id;
  scanSession = await openDoor(event.id);
});

function qrFor(id = invitationId, eventId = event.id) {
  return signQrToken({ eventId, invitationId: id, issuedAt: new Date() });
}

describe('the gate', () => {
  it('mints a session for the right password', async () => {
    const res = await request(app)
      .post(`/api/scan/gate/${event.id}`)
      .send({ password: DOOR_PASSWORD, displayName: 'سعود · بوابة الرجال' });

    expect(res.status).toBe(201);
    expect(res.body.sessionToken).toBeTypeOf('string');
    expect(res.body.displayName).toBe('سعود · بوابة الرجال');
    expect(res.body.event.id).toBe(event.id);
  });

  it('stores the session token hashed, never raw', async () => {
    const token = await openDoor(event.id);
    const row = await prisma.scanUser.findFirstOrThrow({ where: { eventId: event.id } });

    expect(row.sessionTokenHash).not.toBe(token);
    expect(row.sessionTokenHash).toHaveLength(64);
  });

  it('names the scanner even when they skip the field', async () => {
    const res = await request(app)
      .post(`/api/scan/gate/${event.id}`)
      .send({ password: DOOR_PASSWORD });

    // Every check-in must be attributable to *someone*.
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBeTruthy();
  });

  it.each([
    ['a wrong password', { password: 'nope1234' }],
    ['an event with no door password', { password: DOOR_PASSWORD }],
    ['an event that does not exist', { password: DOOR_PASSWORD }],
  ])('gives the same answer for %s', async (label, body) => {
    let target = event.id;

    if (label.includes('no door password')) {
      const other = await createEvent(host.user.id);
      target = other.id;
    } else if (label.includes('does not exist')) {
      target = 'clnonexistentid000000000';
    }

    const res = await request(app).post(`/api/scan/gate/${target}`).send(body);

    // Someone standing outside a venue must learn nothing from this endpoint.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SCAN_GATE_REJECTED');
  });

  it('rate limits password attempts', async () => {
    const strict = createApp({ rateLimits: { scanGate: { windowMs: 60_000, limit: 3 } } });

    for (let attempt = 1; attempt <= 3; attempt++) {
      await request(strict)
        .post(`/api/scan/gate/${event.id}`)
        .send({ password: 'wrong' })
        .expect(401);
    }

    const blocked = await request(strict)
      .post(`/api/scan/gate/${event.id}`)
      .send({ password: 'wrong' });
    expect(blocked.status).toBe(429);
  });

  it('refuses every scan route without a session', async () => {
    await request(app).post('/api/scan/check-in').send({ qrToken: qrFor() }).expect(401);
    await request(app).get('/api/scan/log').expect(401);
    await request(app).get('/api/scan/search').query({ q: 'فيصل' }).expect(401);
  });

  it('refuses a revoked session', async () => {
    const scanUser = await prisma.scanUser.findFirstOrThrow({ where: { eventId: event.id } });
    await request(app)
      .post(`/api/events/${event.id}/scan/sessions/${scanUser.id}/revoke`)
      .set(...host.auth())
      .expect(204);

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SCAN_SESSION_REVOKED');
  });
});

describe('admitting a guest', () => {
  it('admits a confirmed guest and counts their seats', async () => {
    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('VALID');
    expect(res.body.guest.name).toBe('أ. فيصل السبيعي');
    // The number the door needs: the guest plus three companions.
    expect(res.body.guest.seats).toBe(4);
    expect(res.body.messageAr).toBe('تفضّل بالدخول');

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('ATTENDED');

    const checkIn = await prisma.checkIn.findFirstOrThrow({ where: { guestId: guest.id } });
    expect(checkIn.seats).toBe(4);
    expect(checkIn.method).toBe('QR');
  });

  it('attributes the entry to the person on the door', async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);

    const checkIn = await prisma.checkIn.findFirstOrThrow({
      where: { guestId: guest.id },
      include: { scannedBy: true },
    });
    expect(checkIn.scannedBy.displayName).toBe('سعود · بوابة الرجال');
  });

  it('admits by short code when the screen is unreadable', async () => {
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ displayCode: invitation.displayCode });

    expect(res.body.verdict).toBe('VALID');
    const checkIn = await prisma.checkIn.findFirstOrThrow({ where: { guestId: guest.id } });
    expect(checkIn.method).toBe('MANUAL');
  });

  it('accepts a short code typed with Arabic-Indic digits', async () => {
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    const arabic = invitation.displayCode.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ displayCode: arabic });

    expect(res.body.verdict).toBe('VALID');
  });

  it('admits a guest picked from the manual search', async () => {
    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ guestId: guest.id });

    expect(res.body.verdict).toBe('VALID');
  });

  it('rejects a request naming more than one identifier', async () => {
    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor(), guestId: guest.id });

    expect(res.status).toBe(422);
  });
});

describe('double-scan prevention', () => {
  it('answers USED on the second scan and writes nothing', async () => {
    const first = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });
    expect(first.body.verdict).toBe('VALID');

    const second = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    expect(second.status).toBe(200);
    expect(second.body.verdict).toBe('USED');

    // The hard requirement: exactly one check-in exists.
    expect(await prisma.checkIn.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('shows who admitted them and when', async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);

    const otherDoor = await openDoor(event.id, 'نورة · بوابة النساء');
    const second = await request(app)
      .post('/api/scan/check-in')
      .set(door(otherDoor))
      .send({ qrToken: qrFor() });

    // The staff member needs to know it was the other gate, not a forgery.
    expect(second.body.priorCheckIn.scannedByName).toBe('سعود · بوابة الرجال');
    expect(second.body.priorCheckIn.seats).toBe(4);
    expect(second.body.priorCheckIn.scannedAt).toBeTruthy();
  });

  it('holds across every entry path, not just the QR one', async () => {
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });

    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);

    for (const body of [
      { qrToken: qrFor() },
      { displayCode: invitation.displayCode },
      { guestId: guest.id },
    ]) {
      const res = await request(app).post('/api/scan/check-in').set(door(scanSession)).send(body);
      expect(res.body.verdict, JSON.stringify(body)).toBe('USED');
    }

    expect(await prisma.checkIn.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('admits a family exactly once when two doors scan simultaneously', async () => {
    const doorB = await openDoor(event.id, 'نورة · بوابة النساء');

    const [a, b] = await Promise.all([
      request(app).post('/api/scan/check-in').set(door(scanSession)).send({ qrToken: qrFor() }),
      request(app).post('/api/scan/check-in').set(door(doorB)).send({ qrToken: qrFor() }),
    ]);

    // One wins, one is told USED — never two entries, and never a crash. The
    // partial unique index is what makes this deterministic under a race.
    const verdicts = [a.body.verdict, b.body.verdict].sort();
    expect(verdicts).toEqual(['USED', 'VALID']);
    expect(await prisma.checkIn.count({ where: { guestId: guest.id, revokedAt: null } })).toBe(1);
  });
});

describe('the override', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);
  });

  it('admits anyway, as a second attributed entry', async () => {
    const res = await request(app)
      .post('/api/scan/override')
      .set(door(scanSession))
      .send({ guestId: guest.id, seats: 2, reason: 'مرافقان وصلا متأخرين' });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('VALID');

    const checkIns = await prisma.checkIn.findMany({
      where: { guestId: guest.id },
      orderBy: { scannedAt: 'asc' },
      include: { scannedBy: true },
    });

    expect(checkIns).toHaveLength(2);
    expect(checkIns[1]!.isOverride).toBe(true);
    expect(checkIns[1]!.overrideOfId).toBe(checkIns[0]!.id);
    expect(checkIns[1]!.reason).toBe('مرافقان وصلا متأخرين');
    // Traceable to a person on shift — that is the whole point of the override.
    expect(checkIns[1]!.scannedBy.displayName).toBe('سعود · بوابة الرجال');
  });

  it('records the decision in the audit log', async () => {
    await request(app)
      .post('/api/scan/override')
      .set(door(scanSession))
      .send({ guestId: guest.id, seats: 1 })
      .expect(200);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { eventId: event.id, action: 'scan.override' },
    });
    expect(entry.actorType).toBe('SCAN_USER');
    expect(entry.targetId).toBe(guest.id);
  });

  it('refuses to override a guest who has not been admitted', async () => {
    const other = await confirmedGuest(event.id, { name: 'ضيف آخر' });

    const res = await request(app)
      .post('/api/scan/override')
      .set(door(scanSession))
      .send({ guestId: other.guest.id, seats: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCAN_NO_PRIOR_CHECK_IN');
  });

  it('does not let an override break the one-active-entry rule', async () => {
    await request(app)
      .post('/api/scan/override')
      .set(door(scanSession))
      .send({ guestId: guest.id, seats: 1 })
      .expect(200);

    // The override is a second row by design, but the *ordinary* path must
    // still report USED rather than adding a third.
    const again = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    expect(again.body.verdict).toBe('USED');
    expect(await prisma.checkIn.count({ where: { guestId: guest.id } })).toBe(2);
  });
});

describe('refusals', () => {
  it('rejects a code minted for another event', async () => {
    const otherHost = await createUser();
    const otherEvent = await createEvent(otherHost.id);
    const stranger = await confirmedGuest(otherEvent.id, { name: 'ضيف مناسبة أخرى' });

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: stranger.qr });

    expect(res.body.verdict).toBe('WRONG_EVENT');
    expect(res.body.messageAr).toBe('هذا الرمز لا يخص هذه المناسبة');
    expect(await prisma.checkIn.count({ where: { eventId: event.id } })).toBe(0);
    // And nothing about the other event's guest leaks back.
    expect(JSON.stringify(res.body)).not.toContain('ضيف مناسبة أخرى');
  });

  it('rejects a tampered signature', async () => {
    const parts = qrFor().split('.');
    parts[4] = 'A'.repeat(32);

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: parts.join('.') });

    expect(res.body.verdict).toBe('INVALID');
    expect(await prisma.checkIn.count()).toBe(0);
  });

  it('rejects a code re-pointed at another invitation', async () => {
    const other = await confirmedGuest(event.id, { name: 'ضيف ثانٍ' });
    const parts = qrFor().split('.');
    parts[2] = other.invitation.id;

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: parts.join('.') });

    expect(res.body.verdict).toBe('INVALID');
  });

  it.each(['https://example.com', 'WIFI:S:net;P:pw;;', 'not-a-token', ''])(
    'rejects arbitrary QR content (%s)',
    async (junk) => {
      const res = await request(app)
        .post('/api/scan/check-in')
        .set(door(scanSession))
        .send({ qrToken: junk });

      // Guests photograph all sorts of things; the scanner will feed us anything.
      expect([200, 422]).toContain(res.status);
      if (res.status === 200) expect(res.body.verdict).toBe('INVALID');
    },
  );

  it.each(['SENT', 'OPENED', 'DECLINED', 'NOT_SENT'] as const)(
    'refuses a guest whose status is %s',
    async (status) => {
      await prisma.guest.update({ where: { id: guest.id }, data: { status } });

      const res = await request(app)
        .post('/api/scan/check-in')
        .set(door(scanSession))
        .send({ qrToken: qrFor() });

      expect(res.body.verdict).toBe('NOT_CONFIRMED');
      expect(await prisma.checkIn.count({ where: { guestId: guest.id } })).toBe(0);
    },
  );

  it('logs refusals so the host can review them afterwards', async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: 'garbage' })
      .expect(200);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { eventId: event.id, action: 'scan.rejected' },
    });
    expect((entry.meta as Record<string, unknown>).verdict).toBe('INVALID');
  });
});

describe('manual search', () => {
  it('finds a guest by partial name', async () => {
    const res = await request(app)
      .get('/api/scan/search')
      .query({ q: 'فيصل' })
      .set(door(scanSession));

    expect(res.status).toBe(200);
    expect(res.body.guests).toHaveLength(1);
    expect(res.body.guests[0].seats).toBe(4);
    expect(res.body.guests[0].alreadyCheckedIn).toBe(false);
  });

  it('shows who is already inside', async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);

    const res = await request(app)
      .get('/api/scan/search')
      .query({ q: 'فيصل' })
      .set(door(scanSession));

    expect(res.body.guests[0].alreadyCheckedIn).toBe(true);
    expect(res.body.guests[0].checkedInAt).toBeTruthy();
  });

  it('never returns a guest from another event', async () => {
    const otherHost = await createUser();
    const otherEvent = await createEvent(otherHost.id);
    await confirmedGuest(otherEvent.id, { name: 'فيصل من مناسبة أخرى' });

    const res = await request(app)
      .get('/api/scan/search')
      .query({ q: 'فيصل' })
      .set(door(scanSession));

    expect(res.body.guests).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('مناسبة أخرى');
  });
});

describe('the scan log', () => {
  it('counts seats and scans as different numbers', async () => {
    const second = await confirmedGuest(event.id, { name: 'ضيف ثانٍ', companionsConfirmed: 1 });

    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: second.qr })
      .expect(200);

    const res = await request(app).get('/api/scan/log').set(door(scanSession));

    // «١٤٢ مقعدًا دخل · ٥٨ عملية مسح» — one scan admits a family.
    expect(res.body.stats.seatsAdmitted).toBe(6);
    expect(res.body.stats.scans).toBe(2);
    expect(res.body.stats.expectedSeats).toBe(6);
  });

  it('interleaves refusals with entries', async () => {
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() })
      .expect(200);
    await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: 'garbage' })
      .expect(200);

    const res = await request(app).get('/api/scan/log').set(door(scanSession));
    const kinds = res.body.entries.map((e: { kind: string }) => e.kind);

    expect(kinds).toContain('CHECK_IN');
    expect(kinds).toContain('REJECTED');
    expect(res.body.stats.alerts).toBeGreaterThan(0);
  });
});

describe('revoking a check-in', () => {
  let checkInId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });
    checkInId = res.body.checkInId;
  });

  it('walks the guest back to CONFIRMED', async () => {
    await request(app)
      .delete(`/api/events/${event.id}/checkins/${checkInId}`)
      .set(...host.auth())
      .expect(204);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('CONFIRMED');

    const checkIn = await prisma.checkIn.findUniqueOrThrow({ where: { id: checkInId } });
    expect(checkIn.revokedAt).not.toBeNull();
    expect(checkIn.revokedById).toBe(host.user.id);
  });

  it('lets the guest be admitted again — the point of revoking', async () => {
    await request(app)
      .delete(`/api/events/${event.id}/checkins/${checkInId}`)
      .set(...host.auth())
      .expect(204);

    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    expect(res.body.verdict).toBe('VALID');
  });

  it('keeps the guest ATTENDED while an override still admits them', async () => {
    await request(app)
      .post('/api/scan/override')
      .set(door(scanSession))
      .send({ guestId: guest.id, seats: 1 })
      .expect(200);

    await request(app)
      .delete(`/api/events/${event.id}/checkins/${checkInId}`)
      .set(...host.auth())
      .expect(204);

    // One entry was revoked, but the override still stands — they are inside.
    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('ATTENDED');
  });

  it('is not something the door can do', async () => {
    const res = await request(app).delete(`/api/events/${event.id}/checkins/${checkInId}`);
    expect(res.status).toBe(401);
  });

  it('refuses a second revoke of the same entry', async () => {
    await request(app)
      .delete(`/api/events/${event.id}/checkins/${checkInId}`)
      .set(...host.auth())
      .expect(204);

    await request(app)
      .delete(`/api/events/${event.id}/checkins/${checkInId}`)
      .set(...host.auth())
      .expect(404);
  });
});

describe('cross-tenant isolation at the door', () => {
  it('cannot revoke another host’s check-in', async () => {
    const res = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ qrToken: qrFor() });

    const intruder = await createUser();
    const intruderSession = await loginAs(app, intruder);
    const intruderEvent = await createEvent(intruder.id);

    await request(app)
      .delete(`/api/events/${intruderEvent.id}/checkins/${res.body.checkInId}`)
      .set(...intruderSession.auth())
      .expect(404);

    const stillThere = await prisma.checkIn.findUniqueOrThrow({
      where: { id: res.body.checkInId },
    });
    expect(stillThere.revokedAt).toBeNull();
  });

  it('cannot list or revoke another host’s door sessions', async () => {
    const intruder = await createUser();
    const intruderSession = await loginAs(app, intruder);
    const scanUser = await prisma.scanUser.findFirstOrThrow({ where: { eventId: event.id } });

    await request(app)
      .get(`/api/events/${event.id}/scan/sessions`)
      .set(...intruderSession.auth())
      .expect(404);

    const own = await createEvent(intruder.id);
    await request(app)
      .post(`/api/events/${own.id}/scan/sessions/${scanUser.id}/revoke`)
      .set(...intruderSession.auth())
      .expect(409);

    const untouched = await prisma.scanUser.findUniqueOrThrow({ where: { id: scanUser.id } });
    expect(untouched.revokedAt).toBeNull();
  });

  it('binds a door session to its own event, whatever the request says', async () => {
    const otherHost = await createUser();
    const otherEvent = await createEvent(otherHost.id);
    const stranger = await confirmedGuest(otherEvent.id, { name: 'ضيف بعيد' });

    // There is no request shape in which a door names a different event: the
    // event comes from the session row.
    const byId = await request(app)
      .post('/api/scan/check-in')
      .set(door(scanSession))
      .send({ guestId: stranger.guest.id });

    expect(byId.body.verdict).toBe('INVALID');
    expect(await prisma.checkIn.count({ where: { eventId: otherEvent.id } })).toBe(0);
  });
});
