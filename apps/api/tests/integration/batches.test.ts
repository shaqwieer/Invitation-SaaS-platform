/**
 * Delegated invitations — «ترسل لأم العروس ٥٠ دعوة وهي ترسلها لمعازيمها».
 *
 * Five properties carry this suite:
 *
 *   1. A batch mints real invitations — each slot has its own token and its own
 *      QR, so what the delegate hands out is a personal invitation, not a
 *      shared link.
 *   2. The batch token reaches that batch and nothing else. It is not a key to
 *      the event.
 *   3. Unclaimed slots never reach a `wa.me` builder, so the host's own send
 *      queue cannot fill with dead links.
 *   4. A name, once given, belongs to the guest — neither a delegate tidying up
 *      afterwards nor a second holder of a forwarded link can change it.
 *   5. Deleting a batch does not delete people.
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
  uniquePhone,
  type Session,
} from '../helpers/factories.js';

let app: Express;
let host: Session;
let intruder: Session;
let event: EventRow;

beforeAll(() => {
  app = createApp({
    rateLimits: {
      auth: { windowMs: 60_000, limit: 500 },
      rsvp: { windowMs: 60_000, limit: 500 },
      inviteLookup: { windowMs: 60_000, limit: 500 },
    },
  });
});

beforeEach(async () => {
  await resetDb();

  const hostUser = await createUser({ name: 'أم عبدالعزيز' });
  const otherUser = await createUser({ name: 'مضيف آخر' });

  host = await loginAs(app, hostUser);
  intruder = await loginAs(app, otherUser);
  event = await createEvent(hostUser.id);
});

async function makeBatch(count = 3) {
  const res = await request(app)
    .post(`/api/events/${event.id}/batches`)
    .set(...host.auth())
    .send({
      label: 'ضيوف أم العروس',
      delegateName: 'أم العروس',
      delegatePhone: uniquePhone(),
      count,
    });

  expect(res.status).toBe(201);
  return res.body.batch as {
    id: string;
    url: string;
    whatsappUrl: string;
    counts: { total: number };
  };
}

/** The delegate's page, addressed by the token inside the batch URL. */
function tokenOf(batchUrl: string): string {
  return batchUrl.split('/batch/')[1]!;
}

describe('minting a batch', () => {
  it('creates real invitations, one per slot', async () => {
    const batch = await makeBatch(50);
    expect(batch.counts.total).toBe(50);

    const slots = await prisma.guest.findMany({
      where: { eventId: event.id, batchId: batch.id },
      include: { invitation: true },
    });

    expect(slots).toHaveLength(50);
    // Nameless and numberless — that is the whole point: the host is inviting
    // people whose numbers they do not have.
    expect(slots.every((slot) => slot.name === null && slot.phone === null)).toBe(true);
    // Every slot is forwardable the moment the delegate opens the page.
    expect(slots.every((slot) => slot.invitation !== null)).toBe(true);

    // Each invitation is its own — a shared token would be one QR for fifty
    // people at the door.
    const tokens = new Set(slots.map((slot) => slot.invitation!.token));
    expect(tokens.size).toBe(50);

    const codes = new Set(slots.map((slot) => slot.invitation!.displayCode));
    expect(codes.size).toBe(50);
  });

  it('hands the host one link, addressed to the delegate', async () => {
    const batch = await makeBatch(2);
    expect(batch.url).toContain('/batch/');
    expect(batch.whatsappUrl).toContain('wa.me/');
    // One message, not fifty — the ask was «ترسل لأم العروسه ٥٠ كرت».
    expect(batch.whatsappUrl).toContain(encodeURIComponent(batch.url));
  });

  it('is refused to another host', async () => {
    await request(app)
      .post(`/api/events/${event.id}/batches`)
      .set(...intruder.auth())
      .send({ label: 'x', delegateName: 'y z', delegatePhone: uniquePhone(), count: 1 })
      .expect(404);
  });
});

describe('the delegate page', () => {
  it('shows her own slots and no one else’s guests', async () => {
    // A guest of the host's own, who must not appear on her page.
    await createGuest(event.id, { name: 'ضيف المضيف' });
    const batch = await makeBatch(3);

    const res = await request(app).get(`/api/batch/${tokenOf(batch.url)}`).expect(200);

    expect(res.body.batch.slots).toHaveLength(3);
    expect(JSON.stringify(res.body.batch)).not.toContain('ضيف المضيف');
    // Enough of the event to know what she is handing out, and no more.
    expect(res.body.batch.event.title).toBe(event.title);
    expect(res.body.batch).not.toHaveProperty('guests');
  });

  it('carries a full invitation message per slot, not a bare link', async () => {
    const batch = await makeBatch(1);
    const res = await request(app).get(`/api/batch/${tokenOf(batch.url)}`).expect(200);

    const [slot] = res.body.batch.slots;
    expect(slot.url).toContain('/invite/');
    expect(slot.message).toContain(slot.url);
    // No number yet, so nothing to open a chat with.
    expect(slot.whatsappUrl).toBeNull();
  });

  it('is 404 for an unknown token', async () => {
    await request(app).get('/api/batch/zzzzzzzzzzzz').expect(404);
  });

  it('reading the page does not mark anybody as having opened anything', async () => {
    const batch = await makeBatch(3);

    // The delegate opens her list — repeatedly, as she works down it.
    await request(app).get(`/api/batch/${tokenOf(batch.url)}`).expect(200);
    await request(app).get(`/api/batch/${tokenOf(batch.url)}`).expect(200);

    const guests = await prisma.guest.findMany({ where: { batchId: batch.id } });
    const invitations = await prisma.invitation.findMany({ where: { eventId: event.id } });

    // `GET /api/invite/:token` marks OPENED; this page must never call it, or
    // the host's dashboard would report guests reading invitations that have
    // not been sent to anyone yet.
    expect(guests.every((guest) => guest.status === 'NOT_SENT')).toBe(true);
    expect(invitations.every((invitation) => invitation.openedAt === null)).toBe(true);
  });

  it('sends the message in the language the delegate is reading', async () => {
    const batch = await makeBatch(1);

    const ar = await request(app).get(`/api/batch/${tokenOf(batch.url)}`).expect(200);
    const en = await request(app).get(`/api/batch/${tokenOf(batch.url)}?lang=en`).expect(200);

    // An English page handing her an Arabic message to forward would be a
    // strange thing to make her paste into a chat.
    expect(ar.body.batch.slots[0].message).toContain('يشرّفنا');
    expect(en.body.batch.slots[0].message).toContain("You're invited");
  });

  it('cannot address a slot outside its own batch', async () => {
    const mine = await makeBatch(1);
    const other = await makeBatch(1);

    const otherSlot = await prisma.guest.findFirstOrThrow({ where: { batchId: other.id } });

    await request(app)
      .patch(`/api/batch/${tokenOf(mine.url)}/slots/${otherSlot.id}`)
      .send({ name: 'محاولة' })
      .expect(404);
  });
});

describe('distributing', () => {
  it('names a slot and builds its WhatsApp link', async () => {
    const batch = await makeBatch(1);
    const token = tokenOf(batch.url);
    const slot = await prisma.guest.findFirstOrThrow({ where: { batchId: batch.id } });

    const named = await request(app)
      .patch(`/api/batch/${token}/slots/${slot.id}`)
      .send({ name: 'أ. نورة', phone: '0554128830' })
      .expect(200);

    expect(named.body.slot.name).toBe('أ. نورة');
    expect(named.body.slot.phone).toBe('+966554128830');
    expect(named.body.slot.whatsappUrl).toContain('wa.me/966554128830');

    // Naming is not sending.
    expect(named.body.slot.sentAt).toBeNull();

    const sent = await request(app)
      .post(`/api/batch/${token}/slots/${slot.id}/sent`)
      .expect(200);

    expect(sent.body.slot.sentAt).not.toBeNull();
    const after = await prisma.guest.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.status).toBe('SENT');
  });

  it('refuses a number already invited to this event', async () => {
    const phone = uniquePhone();
    await createGuest(event.id, { phone });

    const batch = await makeBatch(1);
    const slot = await prisma.guest.findFirstOrThrow({ where: { batchId: batch.id } });

    const res = await request(app)
      .patch(`/api/batch/${tokenOf(batch.url)}/slots/${slot.id}`)
      .send({ phone });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GUEST_DUPLICATE');
  });

  it('leaves an answered guest’s details alone', async () => {
    const batch = await makeBatch(1);
    const token = tokenOf(batch.url);
    const slot = await prisma.guest.findFirstOrThrow({
      where: { batchId: batch.id },
      include: { invitation: true },
    });

    // The guest answers, giving their own name.
    await request(app)
      .post(`/api/invite/${slot.invitation!.token}/respond`)
      .send({ attending: true, companions: 0, name: 'أ. هيا' })
      .expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: slot.id } });
    expect(stored.name).toBe('أ. هيا');

    // The delegate tidying her sheet afterwards must not overwrite it.
    const res = await request(app)
      .patch(`/api/batch/${token}/slots/${slot.id}`)
      .send({ name: 'اسم آخر' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BATCH_SLOT_ANSWERED');
  });

  it('will not rename a guest who already has a name', async () => {
    const batch = await makeBatch(1);
    const slot = await prisma.guest.findFirstOrThrow({
      where: { batchId: batch.id },
      include: { invitation: true },
    });

    await request(app)
      .patch(`/api/batch/${tokenOf(batch.url)}/slots/${slot.id}`)
      .send({ name: 'أ. نورة' })
      .expect(200);

    // Whoever the link was forwarded on to cannot claim it as theirs.
    await request(app)
      .post(`/api/invite/${slot.invitation!.token}/respond`)
      .send({ attending: true, companions: 0, name: 'شخص آخر' })
      .expect(200);

    const stored = await prisma.guest.findUniqueOrThrow({ where: { id: slot.id } });
    expect(stored.name).toBe('أ. نورة');
  });

  it('enforces the package cap the host bought', async () => {
    await attachPackage(event.id, 1);
    const batch = await makeBatch(3);
    const slot = await prisma.guest.findFirstOrThrow({ where: { batchId: batch.id } });

    const res = await request(app).post(`/api/batch/${tokenOf(batch.url)}/slots/${slot.id}/sent`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GUEST_QUOTA_EXCEEDED');
  });
});

describe('the host’s own send queue', () => {
  it('never offers an unclaimed slot', async () => {
    const reachable = await createGuest(event.id, { name: 'ضيف المضيف' });
    await makeBatch(20);

    const res = await request(app)
      .post(`/api/events/${event.id}/guests/bulk-send`)
      .set(...host.auth())
      .send({ onlyUnsent: true })
      .expect(200);

    // Twenty numberless slots would otherwise render twenty `wa.me/undefined`
    // links — tapped once, never diagnosed.
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0].guestId).toBe(reachable.id);
    expect(res.body.links[0].whatsappUrl).not.toContain('undefined');
  });

  it('answers plainly when the host tries to send one by hand', async () => {
    const batch = await makeBatch(1);
    const slot = await prisma.guest.findFirstOrThrow({ where: { batchId: batch.id } });

    const res = await request(app)
      .post(`/api/events/${event.id}/guests/${slot.id}/send`)
      .set(...host.auth());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GUEST_NO_PHONE');
  });
});

describe('deleting a batch', () => {
  it('removes untouched slots and keeps everyone real', async () => {
    const batch = await makeBatch(5);
    const token = tokenOf(batch.url);
    const slots = await prisma.guest.findMany({ where: { batchId: batch.id } });

    // One named and sent — a person now, with an invitation in someone's hand.
    await request(app)
      .patch(`/api/batch/${token}/slots/${slots[0]!.id}`)
      .send({ name: 'أ. نورة' })
      .expect(200);
    await request(app).post(`/api/batch/${token}/slots/${slots[0]!.id}/sent`).expect(200);

    const res = await request(app)
      .delete(`/api/events/${event.id}/batches/${batch.id}`)
      .set(...host.auth())
      .expect(200);

    expect(res.body.removedSlots).toBe(4);
    expect(res.body.keptGuests).toBe(1);

    const kept = await prisma.guest.findUniqueOrThrow({ where: { id: slots[0]!.id } });
    expect(kept.name).toBe('أ. نورة');
    // The batch is gone; the guest it produced is an ordinary guest now.
    expect(kept.batchId).toBeNull();
  });
});
