import type { Guest, Prisma } from '@prisma/client';
import {
  toWesternDigits,
  type CreateGuestInput,
  type GuestStatusCounts,
  type ListGuestsQuery,
  type UpdateGuestInput,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { assertGuestCeiling } from '../../lib/quota.js';

/**
 * Turn a search box entry into a phone fragment that matches stored E.164.
 *
 * A host searching for "0554128830" is looking for "+966554128830". Stripping
 * the trunk prefix and country code and matching on the remaining suffix makes
 * every way of writing the number find the same guest — which is the same
 * problem normalizePhone solves on write, applied to read.
 */
function phoneFragment(term: string): string | null {
  const digits = toWesternDigits(term).replace(/\D/g, '');
  if (digits.length < 3) return null;

  return digits
    .replace(/^00/, '')
    .replace(/^966/, '')
    .replace(/^0/, '');
}

function buildWhere(eventId: string, query: ListGuestsQuery): Prisma.GuestWhereInput {
  const where: Prisma.GuestWhereInput = { eventId };

  if (query.status) where.status = query.status;
  if (query.group) where.group = query.group;
  if (query.section) where.section = query.section;

  if (query.search) {
    const fragment = phoneFragment(query.search);
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      ...(fragment ? [{ phone: { contains: fragment } }] : []),
    ];
  }

  return where;
}

/** All six statuses, zero-filled — the filter chips must render even at zero. */
export async function guestStatusCounts(eventId: string): Promise<GuestStatusCounts> {
  const grouped = await prisma.guest.groupBy({
    by: ['status'],
    where: { eventId },
    _count: { _all: true },
  });

  const counts: GuestStatusCounts = {
    total: 0,
    NOT_SENT: 0,
    SENT: 0,
    OPENED: 0,
    CONFIRMED: 0,
    DECLINED: 0,
    ATTENDED: 0,
  };

  for (const row of grouped) {
    counts[row.status] = row._count._all;
    counts.total += row._count._all;
  }

  return counts;
}

export async function listGuests(eventId: string, query: ListGuestsQuery) {
  const where = buildWhere(eventId, query);

  const [guests, filtered, counts] = await Promise.all([
    prisma.guest.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        invitation: {
          select: { token: true, displayCode: true, sentAt: true, openedAt: true },
        },
      },
    }),
    prisma.guest.count({ where }),
    // Counts are unfiltered on purpose: the chips show the whole event's
    // breakdown, not the breakdown of whatever filter is currently applied.
    guestStatusCounts(eventId),
  ]);

  return {
    guests,
    counts,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: filtered,
      totalPages: Math.max(1, Math.ceil(filtered / query.pageSize)),
    },
  };
}

export async function createGuest(eventId: string, input: CreateGuestInput, actorId: string) {
  await assertGuestCeiling(eventId, 1);

  const existing = await prisma.guest.findUnique({
    where: { eventId_phone: { eventId, phone: input.phone } },
    select: { id: true, name: true },
  });

  // Checked before insert so the client gets a useful message naming the
  // existing guest, rather than a bare unique-constraint failure.
  if (existing) {
    throw new ConflictError('This number is already a guest of this event', 'GUEST_DUPLICATE', {
      guestId: existing.id,
      name: existing.name,
    });
  }

  const guest = await prisma.guest.create({
    data: {
      eventId,
      name: input.name,
      phone: input.phone,
      group: input.group ?? null,
      section: input.section ?? null,
      companionsAllowed: input.companionsAllowed,
      notes: input.notes ?? null,
    },
  });

  await audit({
    action: 'guest.create',
    actorId,
    eventId,
    targetType: 'Guest',
    targetId: guest.id,
  });

  return guest;
}

export async function getGuest(guestId: string) {
  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    include: { invitation: true, rsvps: { orderBy: { respondedAt: 'desc' }, take: 10 } },
  });
  if (!guest) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');
  return guest;
}

export async function updateGuest(guest: Guest, input: UpdateGuestInput, actorId: string) {
  if (input.phone && input.phone !== guest.phone) {
    const clash = await prisma.guest.findUnique({
      where: { eventId_phone: { eventId: guest.eventId, phone: input.phone } },
      select: { id: true },
    });
    if (clash && clash.id !== guest.id) {
      throw new ConflictError('This number is already a guest of this event', 'GUEST_DUPLICATE');
    }
  }

  const updated = await prisma.guest.update({
    where: { id: guest.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
      ...(input.section !== undefined ? { section: input.section } : {}),
      ...(input.companionsAllowed !== undefined
        ? { companionsAllowed: input.companionsAllowed }
        : {}),
      ...(input.companionsConfirmed !== undefined
        ? { companionsConfirmed: input.companionsConfirmed }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await audit({
    action: 'guest.update',
    actorId,
    eventId: guest.eventId,
    targetType: 'Guest',
    targetId: guest.id,
    meta: { fields: Object.keys(input) },
  });

  return updated;
}

export async function deleteGuest(guest: Guest, actorId: string): Promise<void> {
  await prisma.guest.delete({ where: { id: guest.id } });

  await audit({
    action: 'guest.delete',
    actorId,
    eventId: guest.eventId,
    targetType: 'Guest',
    targetId: guest.id,
    meta: { name: guest.name },
  });
}

/**
 * Bulk operations are always scoped by eventId as well as by id.
 *
 * Without the eventId in the `where`, a host could pass another host's guest ids
 * and mutate them — the ownership check on the *event* would pass while the rows
 * touched belong to someone else. Scoping means unknown ids are simply no-ops.
 */
export async function bulkDeleteGuests(
  eventId: string,
  guestIds: string[],
  actorId: string,
): Promise<number> {
  const { count } = await prisma.guest.deleteMany({ where: { eventId, id: { in: guestIds } } });

  await audit({
    action: 'guest.bulk_delete',
    actorId,
    eventId,
    meta: { requested: guestIds.length, deleted: count },
  });

  return count;
}

export async function bulkSetStatus(
  eventId: string,
  guestIds: string[],
  status: 'NOT_SENT' | 'SENT' | 'CONFIRMED' | 'DECLINED',
  actorId: string,
): Promise<number> {
  const { count } = await prisma.guest.updateMany({
    where: { eventId, id: { in: guestIds } },
    data: { status },
  });

  await audit({
    action: 'guest.bulk_status',
    actorId,
    eventId,
    meta: { requested: guestIds.length, updated: count, status },
  });

  return count;
}
