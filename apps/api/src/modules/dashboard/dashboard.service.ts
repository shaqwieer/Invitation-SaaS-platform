import type { Event } from '@prisma/client';
import type { ActivityEntry, DashboardSummary } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { getGuestQuota } from '../../lib/quota.js';
import { guestStatusCounts } from '../guests/guests.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ratios, not percentages — and never NaN when the denominator is zero. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Mean hours between sending an invitation and the guest answering.
 *
 * Computed in SQL rather than by pulling every invitation: a 600-guest event
 * would otherwise ship 600 rows across the wire to produce one number.
 */
async function averageResponseHours(eventId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ seconds: number | null }>>`
    SELECT AVG(EXTRACT(EPOCH FROM ("respondedAt" - "sentAt"))) AS seconds
    FROM "Invitation"
    WHERE "eventId" = ${eventId}
      AND "sentAt" IS NOT NULL
      AND "respondedAt" IS NOT NULL
      AND "respondedAt" >= "sentAt"
  `;

  const seconds = rows[0]?.seconds;
  return seconds === null || seconds === undefined ? null : Number(seconds) / 3600;
}

/**
 * The «آخر التحديثات» feed.
 *
 * Draws from three places — RSVP rows, check-ins, and audit entries for bulk
 * actions — because the host thinks of them as one stream of "what happened",
 * not as three tables.
 */
async function recentActivity(eventId: string, limit = 10): Promise<ActivityEntry[]> {
  const [rsvps, checkIns, batches] = await Promise.all([
    prisma.rsvpResponse.findMany({
      where: { eventId },
      orderBy: { respondedAt: 'desc' },
      take: limit,
      include: { guest: { select: { name: true } } },
    }),
    prisma.checkIn.findMany({
      where: { eventId, revokedAt: null },
      orderBy: { scannedAt: 'desc' },
      take: limit,
      include: { guest: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { eventId, action: { in: ['invitation.send_batch', 'guest.import'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const entries: ActivityEntry[] = [
    ...rsvps.map((row) => ({
      kind: row.attending ? ('CONFIRMED' as const) : ('DECLINED' as const),
      at: row.respondedAt.toISOString(),
      guestName: row.guest.name,
      count: row.attending ? row.companions : null,
    })),
    ...checkIns.map((row) => ({
      kind: 'CHECKED_IN' as const,
      at: row.scannedAt.toISOString(),
      guestName: row.guest.name,
      count: row.seats,
    })),
    ...batches.map((row) => {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      return {
        kind:
          row.action === 'guest.import' ? ('GUESTS_IMPORTED' as const) : ('INVITES_SENT' as const),
        at: row.createdAt.toISOString(),
        guestName: null,
        count: Number(meta.imported ?? meta.count ?? 0) || null,
      };
    }),
  ];

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function dashboardSummary(event: Event): Promise<DashboardSummary> {
  const [
    counts,
    confirmedSeats,
    attendedSeats,
    potential,
    quota,
    responseHours,
    activity,
    awaiting,
  ] = await Promise.all([
    guestStatusCounts(event.id),

    // A confirmed guest occupies their own seat plus their companions'.
    prisma.guest.aggregate({
      where: { eventId: event.id, status: { in: ['CONFIRMED', 'ATTENDED'] } },
      _sum: { companionsConfirmed: true },
      _count: { _all: true },
    }),

    prisma.checkIn.aggregate({
      where: { eventId: event.id, revokedAt: null },
      _sum: { seats: true },
    }),

    prisma.guest.aggregate({
      where: { eventId: event.id },
      _sum: { companionsAllowed: true },
      _count: { _all: true },
    }),

    getGuestQuota(event.id),
    averageResponseHours(event.id),
    recentActivity(event.id),

    prisma.invitation.aggregate({
      where: {
        eventId: event.id,
        sentAt: { not: null },
        respondedAt: null,
        guest: { status: { in: ['SENT', 'OPENED'] } },
      },
      _min: { sentAt: true },
      _count: { _all: true },
    }),
  ]);

  const confirmedGuests = confirmedSeats._count._all;
  const seatsConfirmed = (confirmedSeats._sum.companionsConfirmed ?? 0) + confirmedGuests;
  const seatsAttended = attendedSeats._sum.seats ?? 0;

  // Everyone the host has actually reached — the denominator for a response
  // rate. Guests still sitting in NOT_SENT have not been asked anything.
  const contacted = counts.total - counts.NOT_SENT;
  const answered = counts.CONFIRMED + counts.DECLINED + counts.ATTENDED;

  const oldestSent = awaiting._min.sentAt;

  return {
    event: {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      venueName: event.venueName,
      status: event.status,
      daysUntil: Math.ceil((event.startsAt.getTime() - Date.now()) / DAY_MS),
    },

    counts,

    seats: {
      confirmed: seatsConfirmed,
      attended: seatsAttended,
      potential: (potential._sum.companionsAllowed ?? 0) + potential._count._all,
    },

    rates: {
      response: ratio(answered, contacted),
      confirmation: ratio(counts.CONFIRMED + counts.ATTENDED, counts.total),
      // Null, not zero, before the doors open: "0% attended" the morning of the
      // wedding would read as a catastrophe rather than as "not yet".
      attendance: seatsConfirmed > 0 && seatsAttended > 0 ? seatsAttended / seatsConfirmed : null,
    },

    averages: {
      companionsPerConfirmedGuest: ratio(
        confirmedSeats._sum.companionsConfirmed ?? 0,
        confirmedGuests,
      ),
      responseHours,
    },

    quota: {
      cap: quota.cap,
      used: quota.used,
      remaining: quota.remaining,
      exceeded: quota.exceeded,
    },

    awaitingReply: {
      count: awaiting._count._all,
      oldestSentDaysAgo: oldestSent
        ? Math.floor((Date.now() - oldestSent.getTime()) / DAY_MS)
        : null,
    },

    activity,
    updatedAt: new Date().toISOString(),
  };
}
