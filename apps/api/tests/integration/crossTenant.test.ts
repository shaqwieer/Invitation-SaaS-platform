/**
 * Cross-tenant isolation.
 *
 * The hard requirement: a host can only ever touch their own events and guests.
 * These tests exist to fail loudly the day someone adds a route that forgets
 * requireEventOwner, so they assert on observable HTTP behaviour rather than on
 * the middleware's internals.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createEvent, createUser, loginAs, resetDb, type Session } from '../helpers/factories.js';

let app: Express;
let hostA: Session;
let hostB: Session;
let admin: Session;
let eventOfA: Awaited<ReturnType<typeof createEvent>>;

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();

  const [a, b, adminUser] = await Promise.all([
    createUser({ name: 'أم عبدالعزيز' }),
    createUser({ name: 'أبو سعد' }),
    createUser({ name: 'مشرف', role: 'ADMIN' }),
  ]);

  [hostA, hostB, admin] = await Promise.all([
    loginAs(app, a),
    loginAs(app, b),
    loginAs(app, adminUser),
  ]);

  eventOfA = await createEvent(a.id, { title: 'حفل زفاف لمى و عبدالعزيز' });
});

describe('reading another host’s event', () => {
  it('lets the owner read it', async () => {
    const res = await request(app)
      .get(`/api/events/${eventOfA.id}`)
      .set(...hostA.auth());

    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(eventOfA.id);
  });

  it('answers 404 — not 403 — for a different host', async () => {
    const res = await request(app)
      .get(`/api/events/${eventOfA.id}`)
      .set(...hostB.auth());

    // 403 would confirm the id is real. To host B, another host's event and a
    // nonexistent one must be indistinguishable, or id enumeration becomes a
    // directory of every event on the platform.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });

  it('is indistinguishable from the response for an id that never existed', async () => {
    const real = await request(app)
      .get(`/api/events/${eventOfA.id}`)
      .set(...hostB.auth());
    const fake = await request(app)
      .get('/api/events/clnonexistentid000000000')
      .set(...hostB.auth());

    // requestId is deliberately unique per request — it is a correlation handle,
    // not part of the answer. Everything that describes *what happened* must match.
    const shape = (body: { error: Record<string, unknown> }) => ({
      code: body.error.code,
      message: body.error.message,
      keys: Object.keys(body.error).sort(),
    });

    expect(real.status).toBe(fake.status);
    expect(shape(real.body)).toEqual(shape(fake.body));
  });

  it('leaks nothing about the event in the error body', async () => {
    const res = await request(app)
      .get(`/api/events/${eventOfA.id}`)
      .set(...hostB.auth());

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('لمى');
    expect(serialized).not.toContain(hostA.user.id);
    expect(serialized).not.toContain('قاعة');
  });

  it('allows an admin across tenants', async () => {
    const res = await request(app)
      .get(`/api/events/${eventOfA.id}`)
      .set(...admin.auth());

    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(eventOfA.id);
  });

  it('requires authentication at all', async () => {
    const res = await request(app).get(`/api/events/${eventOfA.id}`);
    expect(res.status).toBe(401);
  });
});

describe('listing events', () => {
  it('shows a host only their own', async () => {
    await createEvent(hostB.user.id, { title: 'حفل تخرّج' });

    const a = await request(app)
      .get('/api/events')
      .set(...hostA.auth());
    const b = await request(app)
      .get('/api/events')
      .set(...hostB.auth());

    expect(a.body.events).toHaveLength(1);
    expect(a.body.events[0].id).toBe(eventOfA.id);

    expect(b.body.events).toHaveLength(1);
    expect(b.body.events[0].title).toBe('حفل تخرّج');
    expect(b.body.events.map((e: { id: string }) => e.id)).not.toContain(eventOfA.id);
  });

  it('returns an empty list for a host with no events, not everyone else’s', async () => {
    const lonely = await createUser();
    const session = await loginAs(app, lonely);

    const res = await request(app)
      .get('/api/events')
      .set(...session.auth());

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it('shows an admin every tenant’s events', async () => {
    await createEvent(hostB.user.id, { title: 'حفل تخرّج' });

    const res = await request(app)
      .get('/api/events')
      .set(...admin.auth());
    expect(res.body.events).toHaveLength(2);
  });
});

describe('token confusion', () => {
  it('does not accept host B’s access token as host A', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(...hostB.auth());
    expect(res.body.user.id).toBe(hostB.user.id);
    expect(res.body.user.id).not.toBe(hostA.user.id);
  });

  it('rejects an access token signed with the refresh secret', async () => {
    // Guards the env rule that the two secrets must differ: if they were ever
    // unified, a leaked refresh token would be a valid access token.
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: hostA.user.id, role: 'HOST' }, process.env.JWT_REFRESH_SECRET!, {
      issuer: 'da3wa',
      audience: 'da3wa-api',
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});
