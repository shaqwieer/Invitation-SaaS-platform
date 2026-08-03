import type { Event, Guest, Invitation } from '@prisma/client';
import { buildInviteLink, guestDisplayName, type InviteLink } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { env } from '../../config/env.js';
import { generateDisplayCode, generateInviteToken } from '../../lib/inviteToken.js';
import { assertGuestQuota } from '../../lib/quota.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

/**
 * Mint a guest's invitation, if they don't have one yet.
 *
 * Lazy rather than at guest-creation time: a 5,000-row import would otherwise
 * need 5,000 collision-checked token generations before a single guest existed.
 * A guest without an invitation is simply one nobody has tried to contact.
 */
export async function ensureInvitation(guest: Guest): Promise<Invitation> {
  const existing = await prisma.invitation.findUnique({ where: { guestId: guest.id } });
  if (existing) return existing;

  const [token, displayCode] = await Promise.all([
    generateInviteToken(),
    generateDisplayCode(guest.eventId),
  ]);

  try {
    return await prisma.invitation.create({
      data: { guestId: guest.id, eventId: guest.eventId, token, displayCode },
    });
  } catch (err) {
    // Two concurrent sends for the same guest race here; the loser re-reads the
    // winner's row rather than failing the host's click.
    const raced = await prisma.invitation.findUnique({ where: { guestId: guest.id } });
    if (raced) return raced;
    throw err;
  }
}

export interface GuestInviteLink extends InviteLink {
  guestId: string;
  guestName: string;
  phone: string;
  token: string;
  displayCode: string;
}

/** A guest we can actually message — the phone is the whole point of the link. */
type ReachableGuest = Guest & { phone: string };

export function isReachable(guest: Guest): guest is ReachableGuest {
  return guest.phone !== null;
}

function linkFor(
  event: Event,
  guest: ReachableGuest,
  invitation: Invitation,
  locale: 'ar' | 'en',
): GuestInviteLink {
  const template = locale === 'en' ? event.whatsappTemplateEn : event.whatsappTemplateAr;

  const link = buildInviteLink({
    phone: guest.phone,
    // A slot the delegate has not named yet is still addressable — the message
    // simply greets them the way the invitation itself does.
    name: guestDisplayName(guest.name, locale),
    token: invitation.token,
    template,
    baseUrl: env().PUBLIC_WEB_URL,
    extras: {
      eventTitle: event.title,
      hostName: event.hostName,
      venue: event.venueName ?? undefined,
    },
  });

  return {
    ...link,
    guestId: guest.id,
    guestName: guestDisplayName(guest.name, locale),
    phone: guest.phone,
    token: invitation.token,
    displayCode: invitation.displayCode,
  };
}

/**
 * Build the link the host taps, and record that they did.
 *
 * The design's rule: mark SENT when the host clicks the button. We cannot
 * observe whether WhatsApp actually delivered anything — we never touch the
 * message — so the click is the only signal there is. That is also why the
 * button becomes «أُرسلت · إعادة» rather than disappearing: the host needs to
 * see where they stopped, and be able to re-send.
 */
export async function prepareSend(
  event: Event,
  guest: Guest,
  actorId: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<GuestInviteLink> {
  // The package cap is enforced here, not at import: the design defers the
  // upgrade to «ستُطلب ترقية عند الإرسال».
  await assertGuestQuota(event.id);

  if (!isReachable(guest)) {
    // A delegated slot nobody has claimed. The host has no number to send to —
    // that is the delegate's half of the job, on the batch page.
    throw new BadRequestError('Guest has no phone number', 'GUEST_NO_PHONE', {
      messageAr: 'هذه دعوة ضمن دفعة موزَّعة — رقم الضيف يُدخل من صفحة الدفعة.',
    });
  }

  const invitation = await ensureInvitation(guest);
  const link = linkFor(event, guest, invitation, locale);

  await prisma.$transaction([
    prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        sentAt: invitation.sentAt ?? new Date(),
        // A re-send of an already-sent invitation is a reminder; count it.
        ...(invitation.sentAt
          ? { remindersSent: { increment: 1 }, lastReminderAt: new Date() }
          : {}),
      },
    }),
    // Only NOT_SENT advances. A guest who already confirmed must not be knocked
    // back to SENT because the host re-sent their link.
    prisma.guest.updateMany({
      where: { id: guest.id, status: 'NOT_SENT' },
      data: { status: 'SENT' },
    }),
  ]);

  await audit({
    action: invitation.sentAt ? 'invitation.resend' : 'invitation.send',
    actorId,
    eventId: event.id,
    targetType: 'Guest',
    targetId: guest.id,
  });

  return link;
}

export interface BatchSendResult {
  links: GuestInviteLink[];
  /** Guests asked for but not found in this event — silently skipped, never an error. */
  skipped: number;
}

/**
 * Build links for a selection, or for everyone still unsent.
 *
 * Returns every link at once because the client opens WhatsApp once per guest —
 * the design warns about exactly this: «سيفتح واتساب ٣٠ مرة متتالية».
 */
export async function prepareBatchSend(
  event: Event,
  options: { guestIds?: string[]; onlyUnsent?: boolean },
  actorId: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<BatchSendResult> {
  await assertGuestQuota(event.id);

  const guests = await prisma.guest.findMany({
    // Always scoped by eventId, so a foreign guest id is a no-op rather than a
    // cross-tenant read.
    where: {
      eventId: event.id,
      ...(options.guestIds ? { id: { in: options.guestIds } } : {}),
      ...(options.onlyUnsent ? { status: 'NOT_SENT' } : {}),
      // Unclaimed delegated slots are excluded at the query, not filtered after.
      // «أرسلها الآن» would otherwise sweep up fifty numberless slots and hand
      // the host a queue of `wa.me/undefined` links — tapped once, never
      // diagnosed. Those slots are the delegate's to send, from her page.
      phone: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  const links: GuestInviteLink[] = [];
  for (const guest of guests) {
    if (!isReachable(guest)) continue;
    const invitation = await ensureInvitation(guest);
    links.push(linkFor(event, guest, invitation, locale));
  }

  const now = new Date();
  const guestIds = guests.map((g) => g.id);

  await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { guestId: { in: guestIds }, sentAt: null },
      data: { sentAt: now },
    }),
    prisma.guest.updateMany({
      where: { id: { in: guestIds }, status: 'NOT_SENT' },
      data: { status: 'SENT' },
    }),
  ]);

  await audit({
    action: 'invitation.send_batch',
    actorId,
    eventId: event.id,
    meta: { count: links.length, requested: options.guestIds?.length ?? null },
  });

  return {
    links,
    skipped: options.guestIds ? options.guestIds.length - guests.length : 0,
  };
}

/** Preview a link without marking anything — used by the wizard's sample. */
export async function previewLink(
  event: Event,
  guestId: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<GuestInviteLink> {
  const guest = await prisma.guest.findFirst({ where: { id: guestId, eventId: event.id } });
  if (!guest) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');

  if (!isReachable(guest)) {
    throw new BadRequestError('Guest has no phone number', 'GUEST_NO_PHONE', {
      messageAr: 'هذه دعوة ضمن دفعة موزَّعة — رقم الضيف يُدخل من صفحة الدفعة.',
    });
  }

  const invitation = await ensureInvitation(guest);
  return linkFor(event, guest, invitation, locale);
}
