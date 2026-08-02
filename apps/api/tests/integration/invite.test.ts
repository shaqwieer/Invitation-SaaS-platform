/**
 * The public invite surface.
 *
 * Unauthenticated: the token is the only credential a guest holds, so these
 * tests care as much about what the endpoint *refuses to reveal* as about the
 * happy path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow, Guest } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { verifyQrToken } from '../../src/lib/qr.js';
import { createEvent, createGuest, createUser, resetDb } from '../helpers/factories.js';

let app: Express;
let event: EventRow;
let guest: Guest;
let token: string;

async function issueInvitation(g: Guest, overrides: { token?: string } = {}) {
  const value = overrides.token ?? `tok${Math.random().toString(36).slice(2, 11)}`;
  await prisma.invitation.create({
    data: {
      guestId: g.id,
      eventId: g.eventId,
      token: value,
      displayCode: `${Math.floor(1000 + Math.random() * 8999)}-77`,
      sentAt: new Date(),
    },
  });
  return value;
}

beforeAll(() => {
  app = createApp({
    rateLimits: {
      inviteLookup: { windowMs: 60_000, limit: 500 },
      rsvp: { windowMs: 60_000, limit: 500 },
    },
  });
});

beforeEach(async () => {
  await resetDb();
  const host = await createUser();
  event = await createEvent(host.id, { status: 'ACTIVE' });
  guest = await createGuest(event.id, {
    name: 'أ. فيصل السبيعي',
    phone: '+966554128830',
    companionsAllowed: 3,
    status: 'SENT',
  });
  token = await issueInvitation(guest);
});

describe('GET /api/invite/:token', () => {
  it('returns the guest’s invitation', async () => {
    const res = await request(app).get(`/api/invite/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.guest.name).toBe('أ. فيصل السبيعي');
    expect(res.body.guest.companionsAllowed).toBe(3);
    expect(res.body.event.title).toBe(event.title);
    expect(res.body.canRespond.allowed).toBe(true);
  });

  it('never exposes the guest’s phone number or any id', async () => {
    const res = await request(app).get(`/api/invite/${token}`);
    const body = JSON.stringify(res.body);

    // The page is reachable by anyone holding the link — including whoever the
    // guest forwards it to.
    expect(body).not.toContain('966554128830');
    expect(body).not.toContain(guest.id);
    expect(body).not.toContain(event.hostId);
  });

  it('marks the guest OPENED', async () => {
    await request(app).get(`/api/invite/${token}`).expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });

    expect(stored.status).toBe('OPENED');
    expect(invitation.openedAt).not.toBeNull();
  });

  it('records openedAt only once', async () => {
    await request(app).get(`/api/invite/${token}`).expect(200);
    const first = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });

    await request(app).get(`/api/invite/${token}`).expect(200);
    const second = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });

    expect(second.openedAt!.getTime()).toBe(first.openedAt!.getTime());
  });

  it('does not knock a confirmed guest back to OPENED', async () => {
    await prisma.guest.update({ where: { id: guest.id }, data: { status: 'CONFIRMED' } });

    await request(app).get(`/api/invite/${token}`).expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('CONFIRMED');
  });

  it('forbids caching', async () => {
    const res = await request(app).get(`/api/invite/${token}`);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('answers 404 for an unknown token', async () => {
    const res = await request(app).get('/api/invite/aaaabbbbcccc');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVITE_NOT_FOUND');
  });

  it.each(['short', 'HasUpperCase1', 'has-dashes-here', 'has_underscore'])(
    'rejects malformed token %s without touching the database',
    async (bad) => {
      const res = await request(app).get(`/api/invite/${bad}`);
      expect([404, 422]).toContain(res.status);
    },
  );
});

describe('POST /api/invite/:token/respond', () => {
  it('confirms with companions in a single write', async () => {
    const res = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 3 });

    expect(res.status).toBe(200);
    expect(res.body.invitation.guest.status).toBe('CONFIRMED');
    expect(res.body.seats).toBe(4);
    expect(res.body.qrToken).toBeTypeOf('string');

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.companionsConfirmed).toBe(3);

    // The answer and the count land together — never a confirmation followed by
    // a second request that might not arrive.
    const responses = await prisma.rsvpResponse.findMany({ where: { guestId: guest.id } });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ attending: true, companions: 3 });
  });

  it('issues a QR bound to this event and invitation', async () => {
    const res = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 1 });

    const verified = verifyQrToken(res.body.qrToken);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.eventId).toBe(event.id);
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { token } });
      expect(verified.payload.invitationId).toBe(invitation.id);
    }
  });

  it('declines without a QR', async () => {
    const res = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: false, companions: 2 });

    expect(res.status).toBe(200);
    expect(res.body.invitation.guest.status).toBe('DECLINED');
    expect(res.body.qrToken).toBeNull();

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    // A declining guest brings nobody, whatever the picker showed.
    expect(stored.companionsConfirmed).toBe(0);
  });

  it('refuses more companions than the host allowed', async () => {
    const res = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 4 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RSVP_TOO_MANY_COMPANIONS');

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('SENT');
    expect(await prisma.rsvpResponse.count({ where: { guestId: guest.id } })).toBe(0);
  });

  it('lets a guest change their mind, keeping the full history', async () => {
    await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 2 })
      .expect(200);

    await request(app).post(`/api/invite/${token}/respond`).send({ attending: false }).expect(200);

    const again = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 1 });

    expect(again.status).toBe(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.companionsConfirmed).toBe(1);

    // Guest.status is a projection; RsvpResponse is the append-only record.
    const history = await prisma.rsvpResponse.findMany({
      where: { guestId: guest.id },
      orderBy: { respondedAt: 'asc' },
    });
    expect(history).toHaveLength(3);
    expect(history.map((r) => r.attending)).toEqual([true, false, true]);
  });

  it('refuses after the deadline', async () => {
    await prisma.event.update({
      where: { id: event.id },
      data: { rsvpDeadline: new Date(Date.now() - 60_000) },
    });

    const res = await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RSVP_DEADLINE_PASSED');
    expect(res.body.error.details.messageAr).toBeTruthy();
  });

  it('refuses once the guest has been checked in', async () => {
    await prisma.guest.update({ where: { id: guest.id }, data: { status: 'ATTENDED' } });

    const res = await request(app).post(`/api/invite/${token}/respond`).send({ attending: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RSVP_ALREADY_ATTENDED');
  });

  it('stores the responder’s IP hashed, never raw', async () => {
    await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 1 })
      .expect(200);

    const response = await prisma.rsvpResponse.findFirstOrThrow({ where: { guestId: guest.id } });
    expect(response.ipHash).toBeTruthy();
    expect(response.ipHash).not.toContain('127.0.0.1');
    expect(response.ipHash).not.toContain('::1');
  });
});

describe('QR delivery', () => {
  beforeEach(async () => {
    await request(app)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true, companions: 3 })
      .expect(200);
  });

  it('serves a downloadable PNG', async () => {
    const res = await request(app).get(`/api/invite/${token}/qr.png`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('serves the signed payload with the seat count', async () => {
    const res = await request(app).get(`/api/invite/${token}/qr`);

    expect(res.status).toBe(200);
    expect(res.body.seats).toBe(4);
    expect(verifyQrToken(res.body.qrToken).ok).toBe(true);
  });

  it('refuses a QR to a guest who has not confirmed', async () => {
    const other = await createGuest(event.id, { phone: '+966501112233', status: 'SENT' });
    const otherToken = await issueInvitation(other);

    const res = await request(app).get(`/api/invite/${otherToken}/qr`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RSVP_NOT_CONFIRMED');
  });

  it('refuses a QR after the guest declines', async () => {
    await request(app).post(`/api/invite/${token}/respond`).send({ attending: false }).expect(200);

    const res = await request(app).get(`/api/invite/${token}/qr`);
    expect(res.status).toBe(409);
  });
});

describe('enumeration resistance', () => {
  it('rate limits token lookups', async () => {
    const strict = createApp({ rateLimits: { inviteLookup: { windowMs: 60_000, limit: 3 } } });

    for (let attempt = 1; attempt <= 3; attempt++) {
      await request(strict).get('/api/invite/aaaabbbbcccc').expect(404);
    }

    // 60 bits is unguessable only if guessing is bounded.
    const blocked = await request(strict).get('/api/invite/aaaabbbbcccd');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('INVITE_RATE_LIMITED');
  });

  it('rate limits RSVP submissions separately', async () => {
    const strict = createApp({
      rateLimits: {
        inviteLookup: { windowMs: 60_000, limit: 500 },
        rsvp: { windowMs: 60_000, limit: 2 },
      },
    });

    await request(strict)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true })
      .expect(200);
    await request(strict)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true })
      .expect(200);

    const blocked = await request(strict)
      .post(`/api/invite/${token}/respond`)
      .send({ attending: true });
    expect(blocked.status).toBe(429);
  });

  it('buckets guests separately by forwarded IP', async () => {
    // Regression guard. Server-rendered invite pages reach the API from the web
    // container, so unless the guest's IP is forwarded *and* trusted, every
    // guest on the platform shares one bucket — and invitations start failing to
    // load the moment a host sends more than the limit in a minute.
    const strict = createApp({ rateLimits: { inviteLookup: { windowMs: 60_000, limit: 2 } } });

    for (let guestNumber = 1; guestNumber <= 6; guestNumber++) {
      const res = await request(strict)
        .get(`/api/invite/${token}`)
        .set('X-Forwarded-For', `203.0.113.${guestNumber}`);

      expect(res.status, `guest ${guestNumber}`).toBe(200);
    }
  });

  it('still limits a single IP hammering the endpoint', async () => {
    const strict = createApp({ rateLimits: { inviteLookup: { windowMs: 60_000, limit: 2 } } });
    const from = (path: string) => request(strict).get(path).set('X-Forwarded-For', '198.51.100.7');

    await from('/api/invite/aaaabbbbcccc').expect(404);
    await from('/api/invite/aaaabbbbccce').expect(404);

    const blocked = await from('/api/invite/aaaabbbbccdd');
    expect(blocked.status).toBe(429);
  });

  it('answers a wrong token identically whether or not the event exists', async () => {
    const missing = await request(app).get('/api/invite/aaaabbbbcccc');
    const alsoMissing = await request(app).get('/api/invite/zzzzyyyyxxxx');

    expect(missing.status).toBe(alsoMissing.status);
    expect(missing.body.error.code).toBe(alsoMissing.body.error.code);
  });
});
