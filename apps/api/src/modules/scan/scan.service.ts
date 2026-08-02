import { Prisma, type CheckIn, type Event, type Guest, type ScanUser } from '@prisma/client';
import {
  seatsFor,
  toWesternDigits,
  type CheckInInput,
  type ScanGuestSummary,
  type ScanOverrideInput,
  type ScanResult,
  type ScanVerdictValue,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { verifyQrToken } from '../../lib/qr.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';

/**
 * Door verdicts, and what the staff member reads.
 *
 * Every message is short and unambiguous because it is read at arm's length in
 * a dim hall by someone with a queue behind them.
 */
const MESSAGES: Record<ScanVerdictValue, { ar: string; en: string }> = {
  VALID: { ar: 'تفضّل بالدخول', en: 'Welcome in' },
  USED: { ar: 'هذا الرمز مُستخدم من قبل', en: 'This code has already been used' },
  INVALID: { ar: 'رمز غير صالح', en: 'Invalid code' },
  WRONG_EVENT: {
    ar: 'هذا الرمز لا يخص هذه المناسبة',
    en: 'This code belongs to a different event',
  },
  NOT_CONFIRMED: { ar: 'لم يؤكّد هذا الضيف حضوره', en: 'This guest has not confirmed' },
};

function result(
  verdict: ScanVerdictValue,
  extra: Partial<Omit<ScanResult, 'verdict' | 'messageAr' | 'messageEn'>> = {},
): ScanResult {
  return {
    verdict,
    guest: extra.guest ?? null,
    priorCheckIn: extra.priorCheckIn ?? null,
    checkInId: extra.checkInId ?? null,
    scannedAt: extra.scannedAt ?? null,
    messageAr: MESSAGES[verdict].ar,
    messageEn: MESSAGES[verdict].en,
  };
}

function summarize(guest: Guest, displayCode: string): ScanGuestSummary {
  return {
    guestId: guest.id,
    name: guest.name,
    group: guest.group,
    // The number the door actually needs: the guest plus their companions.
    seats: seatsFor(guest.companionsConfirmed),
    displayCode,
    status: guest.status,
  };
}

/** The one check-in that counts: not revoked, not an override. */
function activeCheckIn(guestId: string) {
  return prisma.checkIn.findFirst({
    where: { guestId, revokedAt: null, isOverride: false },
    include: { scannedBy: { select: { displayName: true } } },
  });
}

async function logRejection(
  scanUser: ScanUser,
  verdict: ScanVerdictValue,
  detail: Record<string, unknown>,
): Promise<void> {
  await audit({
    action: 'scan.rejected',
    actorType: 'SCAN_USER',
    actorId: scanUser.id,
    eventId: scanUser.eventId,
    meta: { verdict, ...detail },
  });
}

type Resolved =
  | { ok: true; guest: Guest; displayCode: string }
  | { ok: false; verdict: ScanVerdictValue; detail: Record<string, unknown> };

/**
 * Turn whatever the door presented into a guest of *this* event.
 *
 * The scanner's event comes from its session, never from the request, so there
 * is no shape in which a door can resolve a guest belonging to someone else's
 * wedding.
 */
async function resolveTarget(scanUser: ScanUser, input: CheckInInput): Promise<Resolved> {
  if (input.qrToken) {
    const verified = verifyQrToken(input.qrToken);
    if (!verified.ok) {
      return { ok: false, verdict: 'INVALID', detail: { reason: verified.reason } };
    }

    // Checked before any database work: a code minted for another wedding is
    // rejected on the signed payload alone.
    if (verified.payload.eventId !== scanUser.eventId) {
      return { ok: false, verdict: 'WRONG_EVENT', detail: { eventId: verified.payload.eventId } };
    }

    const invitation = await prisma.invitation.findFirst({
      where: { id: verified.payload.invitationId, eventId: scanUser.eventId },
      include: { guest: true },
    });

    if (!invitation) return { ok: false, verdict: 'INVALID', detail: { reason: 'UNKNOWN_INVITE' } };
    return { ok: true, guest: invitation.guest, displayCode: invitation.displayCode };
  }

  if (input.displayCode) {
    // Door staff type this off a cracked screen, so accept Arabic-Indic digits
    // and whatever separator they used.
    const normalized = toWesternDigits(input.displayCode).replace(/[^0-9]/g, '');
    const code =
      normalized.length === 6
        ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
        : input.displayCode;

    const invitation = await prisma.invitation.findFirst({
      where: { eventId: scanUser.eventId, displayCode: code },
      include: { guest: true },
    });

    if (!invitation) return { ok: false, verdict: 'INVALID', detail: { code } };
    return { ok: true, guest: invitation.guest, displayCode: invitation.displayCode };
  }

  const guest = await prisma.guest.findFirst({
    where: { id: input.guestId!, eventId: scanUser.eventId },
    include: { invitation: { select: { displayCode: true } } },
  });

  if (!guest) return { ok: false, verdict: 'INVALID', detail: { guestId: input.guestId } };
  return { ok: true, guest, displayCode: guest.invitation?.displayCode ?? '—' };
}

/**
 * Admit a guest.
 *
 * A second scan returns USED and **writes nothing** — it reports the entry that
 * already exists, including who let them in and when. Admitting anyway is a
 * separate, explicit override.
 */
export async function checkIn(scanUser: ScanUser, input: CheckInInput): Promise<ScanResult> {
  const target = await resolveTarget(scanUser, input);

  if (!target.ok) {
    await logRejection(scanUser, target.verdict, target.detail);
    return result(target.verdict);
  }

  const { guest, displayCode } = target;
  const summary = summarize(guest, displayCode);

  if (guest.status !== 'CONFIRMED' && guest.status !== 'ATTENDED') {
    await logRejection(scanUser, 'NOT_CONFIRMED', { guestId: guest.id, status: guest.status });
    return result('NOT_CONFIRMED', { guest: summary });
  }

  const existing = await activeCheckIn(guest.id);
  if (existing) {
    await logRejection(scanUser, 'USED', { guestId: guest.id, firstCheckInId: existing.id });
    return result('USED', {
      guest: summary,
      priorCheckIn: {
        scannedAt: existing.scannedAt.toISOString(),
        scannedByName: existing.scannedBy.displayName,
        seats: existing.seats,
      },
    });
  }

  const seats = seatsFor(guest.companionsConfirmed);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const checkInRow = await tx.checkIn.create({
        data: {
          guestId: guest.id,
          eventId: scanUser.eventId,
          seats,
          scannedById: scanUser.id,
          method: input.qrToken ? 'QR' : 'MANUAL',
        },
      });

      await tx.guest.update({ where: { id: guest.id }, data: { status: 'ATTENDED' } });
      return checkInRow;
    });

    await audit({
      action: 'scan.check_in',
      actorType: 'SCAN_USER',
      actorId: scanUser.id,
      eventId: scanUser.eventId,
      targetType: 'Guest',
      targetId: guest.id,
      meta: { seats, method: input.qrToken ? 'QR' : 'MANUAL', checkInId: created.id },
    });

    return result('VALID', {
      guest: { ...summary, status: 'ATTENDED' },
      checkInId: created.id,
      scannedAt: created.scannedAt.toISOString(),
    });
  } catch (err) {
    // Two doors scanned the same guest at the same instant. The partial unique
    // index rejected the loser, which is exactly the guarantee we want — report
    // the winner's entry rather than crashing or double-admitting.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await activeCheckIn(guest.id);
      if (winner) {
        return result('USED', {
          guest: summary,
          priorCheckIn: {
            scannedAt: winner.scannedAt.toISOString(),
            scannedByName: winner.scannedBy.displayName,
            seats: winner.seats,
          },
        });
      }
    }
    throw err;
  }
}

/**
 * Admit a guest whose code was already used.
 *
 * Writes a *second* check-in, flagged as an override and pointing at the
 * original, attributed to the scanner who made the call. The design is explicit
 * that this is not a rejection being bypassed — companions arrive separately,
 * and a hard block jams the door — but the decision belongs to a named person.
 */
export async function overrideCheckIn(
  scanUser: ScanUser,
  input: ScanOverrideInput,
): Promise<ScanResult> {
  const guest = await prisma.guest.findFirst({
    where: { id: input.guestId, eventId: scanUser.eventId },
    include: { invitation: { select: { displayCode: true } } },
  });

  if (!guest) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');

  const original = await activeCheckIn(guest.id);
  if (!original) {
    // Nothing to override — the ordinary path applies and would succeed.
    throw new ConflictError('This guest has no check-in to override', 'SCAN_NO_PRIOR_CHECK_IN');
  }

  const created = await prisma.checkIn.create({
    data: {
      guestId: guest.id,
      eventId: scanUser.eventId,
      seats: input.seats,
      scannedById: scanUser.id,
      method: 'MANUAL',
      isOverride: true,
      overrideOfId: original.id,
      reason: input.reason ?? null,
    },
  });

  await audit({
    action: 'scan.override',
    actorType: 'SCAN_USER',
    actorId: scanUser.id,
    eventId: scanUser.eventId,
    targetType: 'Guest',
    targetId: guest.id,
    meta: {
      seats: input.seats,
      reason: input.reason ?? null,
      overrideOf: original.id,
      checkInId: created.id,
    },
  });

  return result('VALID', {
    guest: summarize(guest, guest.invitation?.displayCode ?? '—'),
    checkInId: created.id,
    scannedAt: created.scannedAt.toISOString(),
  });
}

/** «ابحث بالاسم يدويًا» — find a guest when the screen is unreadable. */
export async function searchGuests(scanUser: ScanUser, query: string) {
  const digits = toWesternDigits(query).replace(/\D/g, '');

  const guests = await prisma.guest.findMany({
    where: {
      eventId: scanUser.eventId,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        ...(digits.length >= 3
          ? [
              { phone: { contains: digits.replace(/^0/, '') } },
              { invitation: { displayCode: { contains: digits.slice(0, 4) } } },
            ]
          : []),
      ],
    },
    take: 20,
    orderBy: { name: 'asc' },
    include: {
      invitation: { select: { displayCode: true } },
      checkIns: {
        where: { revokedAt: null, isOverride: false },
        select: { id: true, scannedAt: true },
        take: 1,
      },
    },
  });

  return guests.map((guest) => ({
    ...summarize(guest, guest.invitation?.displayCode ?? '—'),
    alreadyCheckedIn: guest.checkIns.length > 0,
    checkedInAt: guest.checkIns[0]?.scannedAt.toISOString() ?? null,
  }));
}

/** Host-side: undo a check-in, which frees the guest to be admitted again. */
export async function revokeCheckIn(
  event: Event,
  checkInId: string,
  actorId: string,
): Promise<CheckIn> {
  const checkIn = await prisma.checkIn.findFirst({
    // Scoped by event, so another host's check-in id is simply not found.
    where: { id: checkInId, eventId: event.id, revokedAt: null },
  });

  if (!checkIn) throw new NotFoundError('Check-in not found', 'CHECK_IN_NOT_FOUND');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.checkIn.update({
      where: { id: checkIn.id },
      data: { revokedAt: new Date(), revokedById: actorId },
    });

    // Only walk the guest back to CONFIRMED once nothing else still admits
    // them — an override can outlive the entry it was made against.
    const remaining = await tx.checkIn.count({
      where: { guestId: checkIn.guestId, revokedAt: null },
    });
    if (remaining === 0) {
      await tx.guest.update({ where: { id: checkIn.guestId }, data: { status: 'CONFIRMED' } });
    }

    return row;
  });

  await audit({
    action: 'scan.revoked',
    actorId,
    eventId: event.id,
    targetType: 'CheckIn',
    targetId: checkIn.id,
    meta: { guestId: checkIn.guestId, seats: checkIn.seats },
  });

  return updated;
}
