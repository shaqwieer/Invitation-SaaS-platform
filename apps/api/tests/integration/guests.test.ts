import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
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

describe('creating guests', () => {
  it('normalizes the phone on the way in', async () => {
    const res = await request(app)
      .post(guestsUrl(eventA.id))
      .set(...hostA.auth())
      .send({ name: 'أ. فيصل السبيعي', phone: '0554128830', companionsAllowed: 3 });

    expect(res.status).toBe(201);
    // Stored E.164, which is what makes the duplicate check below work.
    expect(res.body.guest.phone).toBe('+966554128830');
    expect(res.body.guest.status).toBe('NOT_SENT');
  });

  it('refuses a duplicate number with a message naming the existing guest', async () => {
    await createGuest(eventA.id, { name: 'أ. فيصل السبيعي', phone: '+966554128830' });

    const res = await request(app)
      .post(guestsUrl(eventA.id))
      .set(...hostA.auth())
      .send({ name: 'فيصل', phone: '0554128830' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GUEST_DUPLICATE');
    expect(res.body.error.details.name).toBe('أ. فيصل السبيعي');
  });

  it('allows the same number at a different event', async () => {
    await createGuest(eventA.id, { phone: '+966554128830' });

    await request(app)
      .post(guestsUrl(eventB.id))
      .set(...hostB.auth())
      .send({ name: 'أ. فيصل السبيعي', phone: '0554128830' })
      .expect(201);
  });

  it('rejects an unusable phone number', async () => {
    const res = await request(app)
      .post(guestsUrl(eventA.id))
      .set(...hostA.auth())
      .send({ name: 'ضيف', phone: '05012345' });

    expect(res.status).toBe(422);
  });
});

describe('listing guests', () => {
  beforeEach(async () => {
    await Promise.all([
      createGuest(eventA.id, {
        name: 'أ. فيصل السبيعي',
        phone: '+966554128830',
        group: 'عائلة العريس',
        status: 'CONFIRMED',
      }),
      createGuest(eventA.id, {
        name: 'م. نورة القحطاني',
        phone: '+966507331120',
        group: 'صديقات العروس',
        status: 'CONFIRMED',
      }),
      createGuest(eventA.id, {
        name: 'عائلة الدوسري',
        phone: '+966539904471',
        group: 'جيران',
        status: 'DECLINED',
      }),
      createGuest(eventA.id, { name: 'د. سلطان العتيبي', phone: '+966550182264', status: 'SENT' }),
    ]);
  });

  it('returns unfiltered status counts alongside a filtered page', async () => {
    const res = await request(app)
      .get(guestsUrl(eventA.id))
      .query({ status: 'CONFIRMED' })
      .set(...hostA.auth());

    expect(res.status).toBe(200);
    expect(res.body.guests).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    // Chips show the whole event, not the current filter — otherwise filtering
    // by CONFIRMED would make every other chip read zero.
    expect(res.body.counts).toMatchObject({ total: 4, CONFIRMED: 2, DECLINED: 1, SENT: 1 });
  });

  it('finds a guest by name fragment', async () => {
    const res = await request(app)
      .get(guestsUrl(eventA.id))
      .query({ search: 'نورة' })
      .set(...hostA.auth());

    expect(res.body.guests).toHaveLength(1);
    expect(res.body.guests[0].name).toContain('نورة');
  });

  it.each(['0554128830', '554128830', '+966554128830', '4128830', '٠٥٥٤١٢٨٨٣٠'])(
    'finds a guest by phone written as %s',
    async (term) => {
      const res = await request(app)
        .get(guestsUrl(eventA.id))
        .query({ search: term })
        .set(...hostA.auth());

      expect(res.body.guests, `search=${term}`).toHaveLength(1);
      expect(res.body.guests[0].phone).toBe('+966554128830');
    },
  );

  it('filters by group', async () => {
    const res = await request(app)
      .get(guestsUrl(eventA.id))
      .query({ group: 'جيران' })
      .set(...hostA.auth());

    expect(res.body.guests).toHaveLength(1);
  });

  it('paginates', async () => {
    const res = await request(app)
      .get(guestsUrl(eventA.id))
      .query({ page: 2, pageSize: 3 })
      .set(...hostA.auth());

    expect(res.body.guests).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
  });

  it('never leaks guests from another event', async () => {
    await createGuest(eventB.id, { name: 'ضيف مناسبة أخرى', phone: '+966500009999' });

    const res = await request(app).get(guestsUrl(eventA.id)).set(...hostA.auth());

    expect(res.body.counts.total).toBe(4);
    expect(JSON.stringify(res.body)).not.toContain('ضيف مناسبة أخرى');
  });
});

describe('updating guests', () => {
  it('refuses to set ATTENDED by hand', async () => {
    const guest = await createGuest(eventA.id);

    const res = await request(app)
      .patch(`${guestsUrl(eventA.id)}/${guest.id}`)
      .set(...hostA.auth())
      .send({ status: 'ATTENDED' });

    // ATTENDED means "walked through the door" — only a check-in may assert it,
    // or the attendance report becomes a claim rather than a record.
    expect(res.status).toBe(422);
  });

  it('accepts a host-assignable status', async () => {
    const guest = await createGuest(eventA.id);

    const res = await request(app)
      .patch(`${guestsUrl(eventA.id)}/${guest.id}`)
      .set(...hostA.auth())
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(200);
    expect(res.body.guest.status).toBe('CONFIRMED');
  });

  it('refuses a phone change that collides with another guest', async () => {
    await createGuest(eventA.id, { phone: '+966554128830' });
    const other = await createGuest(eventA.id, { phone: '+966507331120' });

    const res = await request(app)
      .patch(`${guestsUrl(eventA.id)}/${other.id}`)
      .set(...hostA.auth())
      .send({ phone: '0554128830' });

    expect(res.status).toBe(409);
  });

  it('allows a no-op phone update on the same guest', async () => {
    const guest = await createGuest(eventA.id, { phone: '+966554128830' });

    await request(app)
      .patch(`${guestsUrl(eventA.id)}/${guest.id}`)
      .set(...hostA.auth())
      .send({ phone: '0554128830', name: 'اسم جديد' })
      .expect(200);
  });
});

describe('bulk operations', () => {
  it('deletes the selected guests', async () => {
    const [one, two, three] = await Promise.all([
      createGuest(eventA.id, { phone: '+966554128831' }),
      createGuest(eventA.id, { phone: '+966554128832' }),
      createGuest(eventA.id, { phone: '+966554128833' }),
    ]);

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-delete`)
      .set(...hostA.auth())
      .send({ guestIds: [one.id, two.id] });

    expect(res.body.deleted).toBe(2);
    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(1);
    expect(await prisma.guest.count({ where: { id: three.id } })).toBe(1);
  });

  it('ignores guest ids belonging to another host’s event', async () => {
    const mine = await createGuest(eventA.id, { phone: '+966554128831' });
    const theirs = await createGuest(eventB.id, { phone: '+966554128899' });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-delete`)
      .set(...hostA.auth())
      .send({ guestIds: [mine.id, theirs.id] });

    // Scoping the deleteMany by eventId as well as id is what makes the foreign
    // id a no-op instead of a cross-tenant delete.
    expect(res.body.deleted).toBe(1);
    expect(await prisma.guest.count({ where: { id: theirs.id } })).toBe(1);
  });

  it('ignores foreign ids on a bulk status change too', async () => {
    const mine = await createGuest(eventA.id, { phone: '+966554128831' });
    const theirs = await createGuest(eventB.id, { phone: '+966554128899', status: 'NOT_SENT' });

    const res = await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-status`)
      .set(...hostA.auth())
      .send({ guestIds: [mine.id, theirs.id], status: 'CONFIRMED' });

    expect(res.body.updated).toBe(1);
    const untouched = await prisma.guest.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.status).toBe('NOT_SENT');
  });

  it('rejects an empty selection', async () => {
    await request(app)
      .post(`${guestsUrl(eventA.id)}/bulk-delete`)
      .set(...hostA.auth())
      .send({ guestIds: [] })
      .expect(422);
  });
});

describe('cross-tenant isolation on guest routes', () => {
  it('refuses to list guests of another host’s event', async () => {
    const res = await request(app).get(guestsUrl(eventA.id)).set(...hostB.auth());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EVENT_NOT_FOUND');
  });

  it('refuses to add a guest to another host’s event', async () => {
    await request(app)
      .post(guestsUrl(eventA.id))
      .set(...hostB.auth())
      .send({ name: 'دخيل', phone: '0554128830' })
      .expect(404);

    expect(await prisma.guest.count({ where: { eventId: eventA.id } })).toBe(0);
  });

  it('refuses to read another event’s guest through an owned event id', async () => {
    const guest = await createGuest(eventA.id);

    // Host B owns eventB, so requireEventOwner passes — the guest must still be
    // checked for membership of that event, or this is a full cross-tenant read.
    const res = await request(app)
      .get(`${guestsUrl(eventB.id)}/${guest.id}`)
      .set(...hostB.auth());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GUEST_NOT_FOUND');
  });

  it('refuses to update another event’s guest through an owned event id', async () => {
    const guest = await createGuest(eventA.id, { name: 'الأصلي' });

    await request(app)
      .patch(`${guestsUrl(eventB.id)}/${guest.id}`)
      .set(...hostB.auth())
      .send({ name: 'مسروق' })
      .expect(404);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored.name).toBe('الأصلي');
  });

  it('refuses to delete another event’s guest through an owned event id', async () => {
    const guest = await createGuest(eventA.id);

    await request(app)
      .delete(`${guestsUrl(eventB.id)}/${guest.id}`)
      .set(...hostB.auth())
      .expect(404);

    expect(await prisma.guest.count({ where: { id: guest.id } })).toBe(1);
  });
});
