/**
 * Sending invitations.
 *
 * We never send anything ourselves — the endpoint builds a wa.me deep link and
 * the host taps it, so the message leaves the host's own number. That is the
 * product's central promise («هل تُرسل الدعوات من رقمي أنا؟ نعم») and the
 * reason the click, not a delivery receipt, is what marks an invitation SENT.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  attachPackage,
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

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();
  const [a, b] = await Promise.all([createUser(), createUser()]);
  [hostA, hostB] = await Promise.all([loginAs(app, a), loginAs(app, b)]);
  [eventA, eventB] = await Promise.all([createEvent(a.id), createEvent(b.id)]);
});

const guestsUrl = (eventId: string) => `/api/events/${eventId}/guests`;

describe('POST /:guestId/send', () => {
  it('returns a wa.me link carrying the guest’s name and private URL', async () => {
    const guest = await createGuest(eventA.id, {
      name: 'أ. فيصل السبيعي',
      phone: '+966554128830',
    });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.link.whatsappUrl).toContain('wa.me/966554128830');

    const decoded = decodeURIComponent(res.body.link.whatsappUrl);
    expect(decoded).toContain('أ. فيصل السبيعي');
    expect(decoded).toContain(res.body.link.url);
    expect(res.body.link.url).toContain('/invite/');
  });

  it('mints a token that exposes nothing about the guest', async () => {
    const guest = await createGuest(eventA.id, { phone: '+966554128830' });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({});

    const token = res.body.link.token as string;

    // The URL must never expose a phone number, a guest id, or a sequential value.
    expect(token).not.toContain(guest.id);
    expect(token).not.toContain('554128830');
    expect(token).toMatch(/^[2-9a-z]{12}$/);
    expect(res.body.link.url).not.toContain(guest.id);
  });

  it('marks the invitation SENT on the click', async () => {
    const guest = await createGuest(eventA.id);

    await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({})
      .expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });

    expect(stored.status).toBe('SENT');
    expect(invitation.sentAt).not.toBeNull();
  });

  it('reuses the same token on a re-send and counts it as a reminder', async () => {
    const guest = await createGuest(eventA.id);
    const url = `${guestsUrl(eventA.id)}/${guest.id}/send`;

    const first = await request(app)
      .post(url)
      .set(...hostA.auth())
      .send({});
    const second = await request(app)
      .post(url)
      .set(...hostA.auth())
      .send({});

    // A guest who already has the link must not receive a different one — they
    // may have saved the first.
    expect(second.body.link.token).toBe(first.body.link.token);

    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });
    expect(invitation.remindersSent).toBe(1);
  });

  it('does not knock a confirmed guest back to SENT', async () => {
    const guest = await createGuest(eventA.id, { status: 'CONFIRMED' });

    await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({})
      .expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('CONFIRMED');
  });

  it('uses the English template when asked', async () => {
    const guest = await createGuest(eventA.id, { name: 'Faisal' });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({ locale: 'en' });

    expect(res.body.link.message).toContain("You're invited");
  });

  it('previews a link without marking anything', async () => {
    const guest = await createGuest(eventA.id);

    const res = await request(app)
      .get(`${guestsUrl(eventA.id)}/${guest.id}/link`)
      .set(...hostA.auth());

    expect(res.status).toBe(200);
    expect(res.body.link.whatsappUrl).toContain('wa.me/');

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.status).toBe('NOT_SENT');
  });
});

describe('POST /bulk-send', () => {
  beforeEach(async () => {
    await Promise.all([
      createGuest(eventA.id, { phone: '+966554128831', status: 'NOT_SENT' }),
      createGuest(eventA.id, { phone: '+966554128832', status: 'NOT_SENT' }),
      createGuest(eventA.id, { phone: '+966554128833', status: 'CONFIRMED' }),
    ]);
  });

  it('builds a link per guest for the selection', async () => {
    const guests = await prisma.guest.findMany({ where: { eventId: eventA.id } });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostA.auth())
      .send({ guestIds: guests.map((g) => g.id) });

    expect(res.status).toBe(200);
    // The client opens WhatsApp once per link — «سيفتح واتساب ٣٠ مرة متتالية».
    expect(res.body.links).toHaveLength(3);
    expect(new Set(res.body.links.map((l: { token: string }) => l.token)).size).toBe(3);
  });

  it('targets only the unsent when asked', async () => {
    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostA.auth())
      .send({ onlyUnsent: true });

    // The dashboard's «أرسلها الآن» on the "not sent yet" tile.
    expect(res.body.links).toHaveLength(2);

    const remaining = await prisma.guest.count({
      where: { eventId: eventA.id, status: 'NOT_SENT' },
    });
    expect(remaining).toBe(0);
  });

  it('ignores guest ids from another host’s event', async () => {
    const mine = await prisma.guest.findFirstOrThrow({ where: { eventId: eventA.id } });
    const theirs = await createGuest(eventB.id, { phone: '+966554128899' });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostA.auth())
      .send({ guestIds: [mine.id, theirs.id] });

    expect(res.body.links).toHaveLength(1);
    expect(res.body.skipped).toBe(1);

    // Their guest must not have been given a link, nor moved off NOT_SENT.
    const untouched = await prisma.guest.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.status).toBe('NOT_SENT');
    expect(await prisma.invitation.count({ where: { guestId: theirs.id } })).toBe(0);
  });

  it('requires either a selection or the unsent flag', async () => {
    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostA.auth())
      .send({});

    expect(res.status).toBe(422);
  });
});

describe('the package cap is enforced at send time', () => {
  it('refuses to send once the guest list outgrows the package', async () => {
    await attachPackage(eventA.id, 2);
    await Promise.all([
      createGuest(eventA.id, { phone: '+966554128841' }),
      createGuest(eventA.id, { phone: '+966554128842' }),
      createGuest(eventA.id, { phone: '+966554128843' }),
    ]);

    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: eventA.id } });

    // Phase 2 deliberately let the list grow past the cap; this is where the
    // design's «ستُطلب ترقية عند الإرسال» actually bites.
    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GUEST_QUOTA_EXCEEDED');
    expect(res.body.error.details).toMatchObject({ cap: 2, used: 3 });
  });

  it('blocks a batch send for the same reason', async () => {
    await attachPackage(eventA.id, 1);
    await Promise.all([
      createGuest(eventA.id, { phone: '+966554128841' }),
      createGuest(eventA.id, { phone: '+966554128842' }),
    ]);

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostA.auth())
      .send({ onlyUnsent: true });

    expect(res.status).toBe(409);
    // Nothing may go out while the event is over its cap.
    expect(await prisma.invitation.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('allows sending within the cap', async () => {
    await attachPackage(eventA.id, 5);
    const guest = await createGuest(eventA.id, { phone: '+966554128841' });

    await request(app)
      .post(`${guestsUrl(eventA.id)}/${guest.id}/send`)
      .set(...hostA.auth())
      .send({})
      .expect(200);
  });
});

describe('cross-tenant isolation on send routes', () => {
  it('refuses to send an invitation for another host’s guest', async () => {
    const guest = await createGuest(eventA.id);

    const res = await request(app)
      .post(`${guestsUrl(eventB.id)}/${guest.id}/send`)
      .set(...hostB.auth())
      .send({});

    expect(res.status).toBe(404);
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(0);
  });

  it('refuses a batch send into another host’s event', async () => {
    await createGuest(eventA.id);

    await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-send`)
      .set(...hostB.auth())
      .send({ onlyUnsent: true })
      .expect(404);

    expect(await prisma.invitation.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('refuses to preview another host’s guest link', async () => {
    const guest = await createGuest(eventA.id);

    await request(app)
      .get(`${guestsUrl(eventB.id)}/${guest.id}/link`)
      .set(...hostB.auth())
      .expect(404);
  });
});
