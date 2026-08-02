import type { Event } from '@prisma/client';
import { seatsFor, type AttendanceReport } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';

/** Half-hour buckets, matching the design's «توزيع الوصول بالساعة» axis. */
const BUCKET_MS = 30 * 60 * 1000;

function bucketStart(at: Date): number {
  return Math.floor(at.getTime() / BUCKET_MS) * BUCKET_MS;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * The post-event report (§12).
 *
 * The headline is deliberately "actual against confirmed", not a raw head
 * count: it is what the host plans the next event's catering on, and the gap
 * between the two — «أكّد ولم يحضر ٣٧» — is the number they cannot get any
 * other way.
 */
export async function attendanceReport(event: Event): Promise<AttendanceReport> {
  const [counts, attendees, checkIns] = await Promise.all([
    prisma.guest.groupBy({
      by: ['status'],
      where: { eventId: event.id },
      _count: { _all: true },
    }),

    // One query carries everything the per-group and no-show sections need:
    // who confirmed, how many seats they promised, and whether they arrived.
    prisma.guest.findMany({
      where: { eventId: event.id, status: { in: ['CONFIRMED', 'ATTENDED'] } },
      select: {
        id: true,
        name: true,
        group: true,
        companionsConfirmed: true,
        checkIns: { where: { revokedAt: null }, select: { seats: true } },
      },
      orderBy: { name: 'asc' },
    }),

    prisma.checkIn.findMany({
      where: { eventId: event.id, revokedAt: null },
      select: { scannedAt: true, seats: true },
      orderBy: { scannedAt: 'asc' },
    }),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const invited = counts.reduce((sum, row) => sum + row._count._all, 0);

  let confirmedSeats = 0;
  let attendedSeats = 0;
  const noShows: AttendanceReport['noShows'] = [];
  const groups = new Map<string, { attendedSeats: number; confirmedSeats: number }>();

  for (const guest of attendees) {
    const promised = seatsFor(guest.companionsConfirmed);
    const arrived = guest.checkIns.reduce((sum, row) => sum + row.seats, 0);

    confirmedSeats += promised;
    attendedSeats += arrived;

    // «الجهة غير محددة» rather than dropping them: a report that silently omits
    // ungrouped guests does not add up to the totals above it.
    const key = guest.group ?? 'غير محدد';
    const bucket = groups.get(key) ?? { attendedSeats: 0, confirmedSeats: 0 };
    bucket.attendedSeats += arrived;
    bucket.confirmedSeats += promised;
    groups.set(key, bucket);

    if (arrived === 0) {
      noShows.push({ guestId: guest.id, name: guest.name, seats: promised, group: guest.group });
    }
  }

  // ── Arrival curve ──────────────────────────────────────────────────────────
  const buckets = new Map<number, { seats: number; scans: number }>();
  for (const row of checkIns) {
    const start = bucketStart(row.scannedAt);
    const bucket = buckets.get(start) ?? { seats: 0, scans: 0 };
    bucket.seats += row.seats;
    bucket.scans += 1;
    buckets.set(start, bucket);
  }

  const peakSeats = Math.max(0, ...[...buckets.values()].map((b) => b.seats));
  const arrivals = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, bucket]) => ({
      at: new Date(start).toISOString(),
      seats: bucket.seats,
      scans: bucket.scans,
      // The half-hour the venue should staff most heavily next time.
      isPeak: bucket.seats === peakSeats && peakSeats > 0,
    }));

  const gaps: number[] = [];
  for (let i = 1; i < checkIns.length; i++) {
    gaps.push((checkIns[i]!.scannedAt.getTime() - checkIns[i - 1]!.scannedAt.getTime()) / 1000);
  }

  const noShowSeats = noShows.reduce((sum, row) => sum + row.seats, 0);

  return {
    event: {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      timezone: event.timezone,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
    },

    headline: {
      attendedSeats,
      confirmedSeats,
      complianceRate: confirmedSeats > 0 ? attendedSeats / confirmedSeats : null,
    },

    counts: {
      invited,
      confirmed: (byStatus.get('CONFIRMED') ?? 0) + (byStatus.get('ATTENDED') ?? 0),
      declined: byStatus.get('DECLINED') ?? 0,
      confirmedNoShow: noShows.length,
      noShowSeats,
    },

    arrivals,

    byGroup: [...groups.entries()]
      .map(([group, bucket]) => ({
        group,
        attendedSeats: bucket.attendedSeats,
        confirmedSeats: bucket.confirmedSeats,
        rate: bucket.confirmedSeats > 0 ? bucket.attendedSeats / bucket.confirmedSeats : 0,
      }))
      .sort((a, b) => b.confirmedSeats - a.confirmedSeats),

    noShows: noShows.sort((a, b) => b.seats - a.seats),

    timings: {
      firstEntry: checkIns[0]?.scannedAt.toISOString() ?? null,
      lastEntry: checkIns.at(-1)?.scannedAt.toISOString() ?? null,
      medianScanGapSeconds: median(gaps),
    },
  };
}
