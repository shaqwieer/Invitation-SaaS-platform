import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createEvent, createUser, loginAs, resetDb, type Session } from '../helpers/factories.js';

let app: Express;
let hostA: Session;
let hostB: Session;

const validEvent = {
  title: 'حفل زفاف لمى و عبدالعزيز',
  type: 'WEDDING',
  startsAt: '2026-11-20T17:30:00.000Z',
  hostName: 'عبدالعزيز بن سعد',
  partnerName: 'لمى بنت خالد',
  venueName: 'قاعة الماسة للاحتفالات',
};

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();
  const [a, b] = await Promise.all([createUser(), createUser()]);
  [hostA, hostB] = await Promise.all([loginAs(app, a), loginAs(app, b)]);
});

describe('POST /api/events', () => {
  it('creates an event owned by the caller', async () => {
    const res = await request(app)
      .post('/api/events')
      .set(...hostA.auth())
      .send(validEvent);

    expect(res.status).toBe(201);
    expect(res.body.event.title).toBe(validEvent.title);
    expect(res.body.event.status).toBe('DRAFT');

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: res.body.event.id } });
    // Ownership comes from the token, never from the request body.
    expect(stored.hostId).toBe(hostA.user.id);
  });

  it('ignores a hostId supplied in the body', async () => {
    const res = await request(app)
      .post('/api/events')
      .set(...hostA.auth())
      .send({ ...validEvent, hostId: hostB.user.id });

    expect(res.status).toBe(201);
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: res.body.event.id } });
    expect(stored.hostId).toBe(hostA.user.id);
  });

  it('rejects an end time before the start', async () => {
    const res = await request(app)
      .post('/api/events')
      .set(...hostA.auth())
      .send({ ...validEvent, endsAt: '2026-11-20T10:00:00.000Z' });

    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.endsAt).toBeDefined();
  });

  it('rejects an RSVP deadline after the event starts', async () => {
    const res = await request(app)
      .post('/api/events')
      .set(...hostA.auth())
      .send({ ...validEvent, rsvpDeadline: '2026-11-25T10:00:00.000Z' });

    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.rsvpDeadline).toBeDefined();
  });

  it('rejects an unknown template', async () => {
    const res = await request(app)
      .post('/api/events')
      .set(...hostA.auth())
      .send({ ...validEvent, templateId: 'does-not-exist' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('requires authentication', async () => {
    await request(app).post('/api/events').send(validEvent).expect(401);
  });
});

describe('PATCH /api/events/:eventId', () => {
  it('applies a partial update without disturbing other fields', async () => {
    const event = await createEvent(hostA.user.id, { title: 'قبل' });

    const res = await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ title: 'بعد' });

    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe('بعد');
    // The wizard saves one step at a time; untouched fields must survive.
    expect(res.body.event.hostName).toBe(event.hostName);
  });

  it('re-checks dates against the stored event, not just the payload', async () => {
    const event = await createEvent(hostA.user.id, {
      startsAt: new Date('2026-11-20T17:30:00.000Z'),
    });

    // rsvpDeadline arrives alone, so the schema has no startsAt to compare it
    // to — the service must fetch the stored one.
    const res = await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ rsvpDeadline: '2026-12-01T00:00:00.000Z' });

    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.rsvpDeadline).toBeDefined();
  });

  it('hashes a scanner password rather than storing it', async () => {
    const event = await createEvent(hostA.user.id);

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ scannerPassword: 'door1234' })
      .expect(200);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.scannerPasswordHash).not.toBeNull();
    expect(stored.scannerPasswordHash).not.toContain('door1234');
    expect(stored.scannerPasswordHash!.startsWith('$argon2')).toBe(true);
  });

  it('clears the scanner password when sent null', async () => {
    const event = await createEvent(hostA.user.id);
    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ scannerPassword: 'door1234' })
      .expect(200);

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ scannerPassword: null })
      .expect(200);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.scannerPasswordHash).toBeNull();
  });

  it('never returns the scanner hash on any read path', async () => {
    const event = await createEvent(hostA.user.id);

    const updated = await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .send({ scannerPassword: 'door1234' });

    const detail = await request(app)
      .get(`/api/events/${event.id}`)
      .set(...hostA.auth());
    const list = await request(app)
      .get('/api/events')
      .set(...hostA.auth());

    // A password digest has no business reaching a browser. Checked on all
    // three paths because it only takes one handler forgetting.
    for (const [label, res] of [
      ['patch', updated],
      ['detail', detail],
      ['list', list],
    ] as const) {
      expect(JSON.stringify(res.body), label).not.toContain('$argon2');
      expect(JSON.stringify(res.body), label).not.toContain('scannerPasswordHash');
    }

    // The client still needs to know whether a password exists.
    expect(detail.body.event.hasScannerPassword).toBe(true);
  });
});

describe('DELETE /api/events/:eventId', () => {
  it('removes the event and its guests', async () => {
    const event = await createEvent(hostA.user.id);
    await prisma.guest.create({
      data: { eventId: event.id, name: 'ضيف', phone: '+966554128830' },
    });

    await request(app)
      .delete(`/api/events/${event.id}`)
      .set(...hostA.auth())
      .expect(204);

    expect(await prisma.event.count({ where: { id: event.id } })).toBe(0);
    // Deleting an event must take its guests' personal data with it.
    expect(await prisma.guest.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe('cross-tenant isolation on every event route', () => {
  it.each([
    ['get', (id: string) => `/api/events/${id}`],
    ['patch', (id: string) => `/api/events/${id}`],
    ['delete', (id: string) => `/api/events/${id}`],
    ['get', (id: string) => `/api/events/${id}/quota`],
  ] as const)('%s %s answers 404 for a different host', async (method, path) => {
    const event = await createEvent(hostA.user.id);

    // Bound to a local first: `request(app)\n[method](...)` reads as an index
    // into the previous expression, not a fresh statement.
    const agent = request(app);
    const res = await agent[method](path(event.id))
      .set(...hostB.auth())
      .send({ title: 'اختراق' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });

  it('leaves the event untouched after a rejected cross-tenant write', async () => {
    const event = await createEvent(hostA.user.id, { title: 'الأصلي' });

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...hostB.auth())
      .send({ title: 'مسروق' })
      .expect(404);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.title).toBe('الأصلي');
  });

  it('does not delete another host’s event', async () => {
    const event = await createEvent(hostA.user.id);

    await request(app)
      .delete(`/api/events/${event.id}`)
      .set(...hostB.auth())
      .expect(404);
    expect(await prisma.event.count({ where: { id: event.id } })).toBe(1);
  });
});

describe('GET /api/events/:eventId/quota', () => {
  it('reports no cap when no package is attached', async () => {
    const event = await createEvent(hostA.user.id);
    const res = await request(app)
      .get(`/api/events/${event.id}/quota`)
      .set(...hostA.auth());

    expect(res.status).toBe(200);
    expect(res.body.quota).toMatchObject({ cap: null, used: 0, exceeded: false });
  });
});
