import crypto from 'node:crypto';
import { verify as argonVerify } from '@node-rs/argon2';
import type { Event, ScanUser } from '@prisma/client';
import type { ScanGateInput, ScanSession } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';

export const SCAN_SESSION_HEADER = 'x-scan-session';

/**
 * A door session lasts one night.
 *
 * The password is handed to whoever is on shift, so a session that lived
 * forever would keep working long after that person went home — and after the
 * host rotated the password for the next event.
 */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function hashSession(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Open the gate.
 *
 * Deliberately gives the same answer for a wrong password and an event with no
 * password set — otherwise the endpoint reports which events have a live door,
 * which is a useful thing for someone standing outside a venue to learn.
 */
export async function openGate(
  event: Event,
  input: ScanGateInput,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<ScanSession> {
  const rejected = new UnauthorizedError('Incorrect event password', 'SCAN_GATE_REJECTED');

  if (!event.scannerPasswordHash) throw rejected;
  if (!(await argonVerify(event.scannerPasswordHash, input.password).catch(() => false))) {
    throw rejected;
  }

  const raw = crypto.randomBytes(32).toString('base64url');
  const displayName = input.displayName?.trim() || 'مسؤول الاستقبال';

  const scanUser = await prisma.scanUser.create({
    data: {
      eventId: event.id,
      displayName,
      sessionTokenHash: hashSession(raw),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });

  await audit({
    action: 'scan.gate_opened',
    actorType: 'SCAN_USER',
    actorId: scanUser.id,
    eventId: event.id,
    meta: { displayName },
    ip: meta.ip ?? null,
  });

  return {
    sessionToken: raw,
    scanUserId: scanUser.id,
    displayName,
    event: {
      id: event.id,
      title: event.title,
      venueName: event.venueName,
      startsAt: event.startsAt.toISOString(),
    },
  };
}

/** Resolve a session header to the scanner on shift, or reject. */
export async function resolveSession(
  raw: string | undefined,
): Promise<ScanUser & { event: Event }> {
  if (!raw) throw new UnauthorizedError('Scanner session required', 'SCAN_SESSION_MISSING');

  const scanUser = await prisma.scanUser.findUnique({
    where: { sessionTokenHash: hashSession(raw) },
    include: { event: true },
  });

  if (!scanUser) throw new UnauthorizedError('Invalid scanner session', 'SCAN_SESSION_INVALID');
  if (scanUser.revokedAt) {
    throw new UnauthorizedError('Scanner session revoked', 'SCAN_SESSION_REVOKED');
  }
  if (Date.now() - scanUser.createdAt.getTime() > SESSION_MAX_AGE_MS) {
    throw new UnauthorizedError('Scanner session expired', 'SCAN_SESSION_EXPIRED');
  }

  // Fire-and-forget: a failed heartbeat must not fail the scan behind it.
  void prisma.scanUser
    .update({ where: { id: scanUser.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return scanUser;
}

/** Host-side: end a door session (someone left, or the password leaked). */
export async function revokeSession(
  eventId: string,
  scanUserId: string,
  actorId: string,
): Promise<void> {
  const { count } = await prisma.scanUser.updateMany({
    // Scoped by eventId so another host's session id is a no-op.
    where: { id: scanUserId, eventId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0)
    throw new ConflictError('Session not found or already revoked', 'SCAN_SESSION_NOT_FOUND');

  await audit({
    action: 'scan.session_revoked',
    actorId,
    eventId,
    targetType: 'ScanUser',
    targetId: scanUserId,
  });
}

export async function listSessions(eventId: string) {
  return prisma.scanUser.findMany({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      displayName: true,
      createdAt: true,
      lastSeenAt: true,
      revokedAt: true,
      _count: { select: { checkIns: true } },
    },
  });
}
