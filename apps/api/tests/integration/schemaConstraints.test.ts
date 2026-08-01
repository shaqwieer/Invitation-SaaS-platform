/**
 * Database-level guarantees.
 *
 * These constraints are the backstop behind application logic. Each one is here
 * because losing it would be silent — the app would keep working and quietly
 * produce duplicate guests, colliding codes, or double check-ins.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createEvent, createUser, resetDb } from '../helpers/factories.js';

async function twoEvents() {
  const host = await createUser();
  return Promise.all([createEvent(host.id), createEvent(host.id, { title: 'حفل تخرّج' })]);
}

beforeEach(async () => {
  await resetDb();
});

describe('Guest uniqueness', () => {
  it('rejects the same number twice in one event', async () => {
    const [event] = await twoEvents();

    await prisma.guest.create({
      data: { eventId: event.id, name: 'أ. فيصل السبيعي', phone: '+966554128830' },
    });

    await expect(
      prisma.guest.create({
        data: { eventId: event.id, name: 'فيصل السبيعي', phone: '+966554128830' },
      }),
    ).rejects.toThrow();
  });

  it('allows the same person to be a guest at two different events', async () => {
    const [first, second] = await twoEvents();

    await prisma.guest.create({
      data: { eventId: first.id, name: 'أ. فيصل السبيعي', phone: '+966554128830' },
    });

    // Scoped per event, not global — the same uncle attends both weddings.
    await expect(
      prisma.guest.create({
        data: { eventId: second.id, name: 'أ. فيصل السبيعي', phone: '+966554128830' },
      }),
    ).resolves.toBeDefined();
  });
});

describe('Invitation identifiers', () => {
  it('keeps invite tokens globally unique', async () => {
    const [first, second] = await twoEvents();

    const guestA = await prisma.guest.create({
      data: { eventId: first.id, name: 'ضيف أ', phone: '+966554128831' },
    });
    const guestB = await prisma.guest.create({
      data: { eventId: second.id, name: 'ضيف ب', phone: '+966554128832' },
    });

    await prisma.invitation.create({
      data: { guestId: guestA.id, eventId: first.id, token: 'abc123def456', displayCode: '1111-11' },
    });

    // The token is the whole URL's secrecy — two guests sharing one would hand
    // each other's invitation over.
    await expect(
      prisma.invitation.create({
        data: {
          guestId: guestB.id,
          eventId: second.id,
          token: 'abc123def456',
          displayCode: '2222-22',
        },
      }),
    ).rejects.toThrow();
  });

  it('scopes display codes per event rather than globally', async () => {
    const [first, second] = await twoEvents();

    const guestA = await prisma.guest.create({
      data: { eventId: first.id, name: 'ضيف أ', phone: '+966554128831' },
    });
    const guestB = await prisma.guest.create({
      data: { eventId: second.id, name: 'ضيف ب', phone: '+966554128832' },
    });

    await prisma.invitation.create({
      data: { guestId: guestA.id, eventId: first.id, token: 'tok1aaaaaaaa', displayCode: '4821-77' },
    });

    // Six digits would collide constantly if global. The scanner only ever
    // resolves a code inside its own event.
    await expect(
      prisma.invitation.create({
        data: {
          guestId: guestB.id,
          eventId: second.id,
          token: 'tok2bbbbbbbb',
          displayCode: '4821-77',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate display code within one event', async () => {
    const [event] = await twoEvents();

    const guestA = await prisma.guest.create({
      data: { eventId: event.id, name: 'ضيف أ', phone: '+966554128831' },
    });
    const guestB = await prisma.guest.create({
      data: { eventId: event.id, name: 'ضيف ب', phone: '+966554128832' },
    });

    await prisma.invitation.create({
      data: { guestId: guestA.id, eventId: event.id, token: 'tok1aaaaaaaa', displayCode: '4821-77' },
    });

    await expect(
      prisma.invitation.create({
        data: {
          guestId: guestB.id,
          eventId: event.id,
          token: 'tok2bbbbbbbb',
          displayCode: '4821-77',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('CheckIn — one active check-in per guest', () => {
  async function scenario() {
    const [event] = await twoEvents();
    const guest = await prisma.guest.create({
      data: {
        eventId: event.id,
        name: 'أ. فيصل السبيعي',
        phone: '+966554128830',
        status: 'CONFIRMED',
        companionsConfirmed: 3,
      },
    });
    const scanner = await prisma.scanUser.create({
      data: {
        eventId: event.id,
        displayName: 'سعود · بوابة الرجال',
        sessionTokenHash: `hash_${Math.random()}`,
      },
    });
    return { event, guest, scanner };
  }

  it('accepts the first check-in', async () => {
    const { event, guest, scanner } = await scenario();

    await expect(
      prisma.checkIn.create({
        data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a second plain check-in for the same guest', async () => {
    const { event, guest, scanner } = await scenario();

    await prisma.checkIn.create({
      data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
    });

    // The partial unique index is what makes this safe under a race between two
    // scanners at two doors — an application-level "already checked in?" read
    // would let both writes through.
    await expect(
      prisma.checkIn.create({
        data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
      }),
    ).rejects.toThrow();
  });

  it('permits an explicit override as a second, attributed row', async () => {
    const { event, guest, scanner } = await scenario();

    const original = await prisma.checkIn.create({
      data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
    });

    // An override is meant to be a second row: companions arrive separately and
    // hard blocking jams the door. It is recorded, not silent.
    const override = await prisma.checkIn.create({
      data: {
        guestId: guest.id,
        eventId: event.id,
        seats: 1,
        scannedById: scanner.id,
        isOverride: true,
        overrideOfId: original.id,
        reason: 'مرافق وصل متأخرًا',
      },
    });

    expect(override.isOverride).toBe(true);
    expect(override.overrideOfId).toBe(original.id);
    expect(override.scannedById).toBe(scanner.id);
  });

  it('frees the guest to be checked in again once a check-in is revoked', async () => {
    const { event, guest, scanner } = await scenario();
    const host = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

    const first = await prisma.checkIn.create({
      data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
    });

    await prisma.checkIn.update({
      where: { id: first.id },
      data: { revokedAt: new Date(), revokedById: host.hostId },
    });

    await expect(
      prisma.checkIn.create({
        data: { guestId: guest.id, eventId: event.id, seats: 4, scannedById: scanner.id },
      }),
    ).resolves.toBeDefined();
  });
});

describe('Webhook idempotency', () => {
  it('rejects a replayed provider event', async () => {
    await prisma.webhookEvent.create({
      data: { provider: 'stub', providerEventId: 'evt_123', type: 'payment.paid', payload: {} },
    });

    // Every gateway retries. Without this, a retry double-applies a payment.
    await expect(
      prisma.webhookEvent.create({
        data: { provider: 'stub', providerEventId: 'evt_123', type: 'payment.paid', payload: {} },
      }),
    ).rejects.toThrow();
  });

  it('allows the same id from a different provider', async () => {
    await prisma.webhookEvent.create({
      data: { provider: 'stub', providerEventId: 'evt_123', type: 'payment.paid', payload: {} },
    });

    await expect(
      prisma.webhookEvent.create({
        data: { provider: 'moyasar', providerEventId: 'evt_123', type: 'payment.paid', payload: {} },
      }),
    ).resolves.toBeDefined();
  });
});
