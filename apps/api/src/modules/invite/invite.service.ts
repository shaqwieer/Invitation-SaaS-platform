import crypto from 'node:crypto';
import type { Event, Guest, Invitation, Template } from '@prisma/client';
import {
  canRespond,
  checkCompanions,
  seatsFor,
  statusAfterOpen,
  statusForResponse,
  type PublicInvitation,
  type RespondInput,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { signQrToken } from '../../lib/qr.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';

type LoadedInvitation = Invitation & {
  guest: Guest;
  event: Event & { template: Pick<Template, 'key'> | null };
};

/**
 * Resolve a public token.
 *
 * The same NotFoundError for every failure — unknown token, deleted event,
 * deleted guest. This endpoint is unauthenticated and the token is the only
 * credential, so any distinguishable response turns it into an oracle for
 * probing which tokens exist.
 */
async function load(token: string): Promise<LoadedInvitation> {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { guest: true, event: { include: { template: { select: { key: true } } } } },
  });

  if (!invitation) throw new NotFoundError('Invitation not found', 'INVITE_NOT_FOUND');
  return invitation as LoadedInvitation;
}

/** IPs are kept only to spot abuse, so they are stored one-way, never raw. */
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHmac('sha256', env().QR_HMAC_SECRET).update(ip).digest('hex').slice(0, 32);
}

function toPublic(invitation: LoadedInvitation): PublicInvitation {
  const { guest, event } = invitation;

  return {
    guest: {
      name: guest.name,
      companionsAllowed: guest.companionsAllowed,
      companionsConfirmed: guest.companionsConfirmed,
      status: guest.status,
    },
    event: {
      title: event.title,
      type: event.type,
      hostName: event.hostName,
      partnerName: event.partnerName,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      timezone: event.timezone,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      venueLat: event.venueLat,
      venueLng: event.venueLng,
      venueMapUrl: event.venueMapUrl,
      cardColor: event.cardColor,
      cardTitleFont: event.cardTitleFont,
      customCardUrl: event.customCardUrl,
      templateKey: event.template?.key ?? null,
      rsvpDeadline: event.rsvpDeadline?.toISOString() ?? null,
      sectionMode: event.sectionMode,
    },
    invitation: {
      displayCode: invitation.displayCode,
      respondedAt: invitation.respondedAt?.toISOString() ?? null,
    },
    canRespond: canRespond({
      status: guest.status,
      rsvpDeadline: event.rsvpDeadline,
      eventStatus: event.status,
    }),
  };
}

/**
 * Read an invitation, recording that the guest opened it.
 *
 * The open is a side effect of a GET, which is normally a smell — but it is the
 * only moment we can observe, and the host's dashboard distinguishes "sent" from
 * "seen but unanswered". It is idempotent: openedAt is written once, and the
 * status only advances from the two pre-answer states.
 */
export async function viewInvitation(token: string): Promise<PublicInvitation> {
  const invitation = await load(token);
  const nextStatus = statusAfterOpen(invitation.guest.status);

  if (!invitation.openedAt || nextStatus !== invitation.guest.status) {
    await prisma.$transaction([
      prisma.invitation.updateMany({
        where: { id: invitation.id, openedAt: null },
        data: { openedAt: new Date() },
      }),
      prisma.guest.updateMany({
        where: { id: invitation.guest.id, status: { in: ['NOT_SENT', 'SENT'] } },
        data: { status: nextStatus },
      }),
    ]);

    invitation.guest.status = nextStatus;
    invitation.openedAt ??= new Date();
  }

  return toPublic(invitation);
}

export interface RespondResult {
  invitation: PublicInvitation;
  /** Present only once the guest is confirmed. */
  qrToken: string | null;
  seats: number | null;
}

/**
 * Record an answer.
 *
 * One transaction covering the response row, the guest projection and the
 * invitation timestamps — a confirmed guest with no RsvpResponse, or a status
 * that disagrees with the latest response, is a state the reports cannot make
 * sense of.
 */
export async function respond(
  token: string,
  input: RespondInput,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<RespondResult> {
  const invitation = await load(token);
  const { guest, event } = invitation;

  const allowed = canRespond({
    status: guest.status,
    rsvpDeadline: event.rsvpDeadline,
    eventStatus: event.status,
  });

  if (!allowed.allowed) {
    throw new ConflictError(allowed.messageEn ?? 'Cannot respond', `RSVP_${allowed.reason}`, {
      reason: allowed.reason,
      messageAr: allowed.messageAr,
      messageEn: allowed.messageEn,
    });
  }

  if (input.attending) {
    const companions = checkCompanions(input.companions, guest.companionsAllowed);
    if (!companions.allowed) {
      throw new BadRequestError(
        companions.messageEn ?? 'Too many companions',
        'RSVP_TOO_MANY_COMPANIONS',
        { allowed: guest.companionsAllowed, messageAr: companions.messageAr },
      );
    }
  }

  const status = statusForResponse(input.attending);
  const now = new Date();

  await prisma.$transaction([
    prisma.rsvpResponse.create({
      data: {
        guestId: guest.id,
        eventId: event.id,
        attending: input.attending,
        companions: input.companions,
        respondedAt: now,
        ipHash: hashIp(meta.ip),
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    }),
    prisma.guest.update({
      where: { id: guest.id },
      data: { status, companionsConfirmed: input.companions },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        respondedAt: now,
        // Re-issued on every confirmation: changing the companion count changes
        // how many seats the code admits, so the old one must not linger.
        qrIssuedAt: input.attending ? now : null,
      },
    }),
  ]);

  invitation.guest.status = status;
  invitation.guest.companionsConfirmed = input.companions;
  invitation.respondedAt = now;

  return {
    invitation: toPublic(invitation),
    qrToken: input.attending
      ? signQrToken({ eventId: event.id, invitationId: invitation.id, issuedAt: now })
      : null,
    seats: input.attending ? seatsFor(input.companions) : null,
  };
}

/**
 * Mint the QR for a confirmed guest.
 *
 * Regenerated on demand rather than stored: it is a pure function of
 * (eventId, invitationId, issuedAt) and the server secret, so there is nothing
 * to keep in sync — and rotating QR_HMAC_SECRET invalidates every outstanding
 * code by construction.
 */
export async function qrTokenFor(
  token: string,
): Promise<{ qrToken: string; seats: number; guestName: string; displayCode: string }> {
  const invitation = await load(token);

  if (invitation.guest.status !== 'CONFIRMED' && invitation.guest.status !== 'ATTENDED') {
    throw new ConflictError('Guest has not confirmed', 'RSVP_NOT_CONFIRMED');
  }

  return {
    qrToken: signQrToken({
      eventId: invitation.eventId,
      invitationId: invitation.id,
      issuedAt: invitation.qrIssuedAt ?? invitation.respondedAt ?? new Date(),
    }),
    seats: seatsFor(invitation.guest.companionsConfirmed),
    guestName: invitation.guest.name,
    displayCode: invitation.displayCode,
  };
}
