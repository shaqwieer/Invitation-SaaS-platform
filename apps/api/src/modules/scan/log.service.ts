import type { ScanLogEntry, ScanStats, ScanVerdictValue } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * Door counters.
 *
 * `seatsAdmitted` sums seats rather than counting rows, because one scan admits
 * a family — the design's log reads «١٤٢ مقعدًا دخل · ٥٨ عملية مسح», and those
 * are deliberately different numbers.
 */
export async function scanStats(eventId: string): Promise<ScanStats> {
  const [admitted, rejected, expected] = await Promise.all([
    prisma.checkIn.aggregate({
      where: { eventId, revokedAt: null },
      _sum: { seats: true },
      _count: { _all: true },
    }),
    prisma.auditLog.count({ where: { eventId, action: 'scan.rejected' } }),
    prisma.guest.aggregate({
      where: { eventId, status: { in: ['CONFIRMED', 'ATTENDED'] } },
      _sum: { companionsConfirmed: true },
      _count: { _all: true },
    }),
  ]);

  const overrides = await prisma.checkIn.count({
    where: { eventId, revokedAt: null, isOverride: true },
  });

  return {
    seatsAdmitted: admitted._sum.seats ?? 0,
    scans: admitted._count._all,
    // What the staff should look at afterwards: refused codes and every
    // deliberate override.
    alerts: rejected + overrides,
    // Each confirmed guest occupies their own seat plus their companions'.
    expectedSeats: (expected._sum.companionsConfirmed ?? 0) + expected._count._all,
  };
}

/**
 * One timeline of everything that happened at the door.
 *
 * Check-ins and refused scans are stored in different tables — the first is a
 * fact about the event, the second an audit record — but the person on the door
 * needs them interleaved, because "unknown code at 8:58" only makes sense next
 * to the entries around it.
 */
export async function scanLog(eventId: string, limit = 50): Promise<ScanLogEntry[]> {
  const [checkIns, rejections] = await Promise.all([
    prisma.checkIn.findMany({
      where: { eventId, revokedAt: null },
      orderBy: { scannedAt: 'desc' },
      take: limit,
      include: {
        guest: { select: { name: true } },
        scannedBy: { select: { displayName: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { eventId, action: 'scan.rejected' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const scannerNames = new Map(
    (
      await prisma.scanUser.findMany({
        where: { eventId },
        select: { id: true, displayName: true },
      })
    ).map((s) => [s.id, s.displayName]),
  );

  const entries: ScanLogEntry[] = [
    ...checkIns.map((row) => ({
      kind: row.isOverride ? ('OVERRIDE' as const) : ('CHECK_IN' as const),
      at: row.scannedAt.toISOString(),
      guestName: row.guest.name,
      seats: row.seats,
      scannedByName: row.scannedBy.displayName,
      verdict: null,
      detail: row.isOverride ? (row.reason ?? 'رمز مكرر — سُمح بالدخول') : null,
      checkInId: row.id,
    })),
    ...rejections.map((row) => {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      return {
        kind: 'REJECTED' as const,
        at: row.createdAt.toISOString(),
        guestName: null,
        seats: null,
        scannedByName: row.actorId ? (scannerNames.get(row.actorId) ?? null) : null,
        verdict: (meta.verdict as ScanVerdictValue) ?? 'INVALID',
        detail: (meta.code as string) ?? (meta.reason as string) ?? null,
        checkInId: null,
      };
    }),
  ];

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
