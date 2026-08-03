import { Prisma, type Event, type Guest, type GuestBatch } from '@prisma/client';
import {
  buildInviteUrl,
  buildWhatsAppLink,
  guestDisplayName,
  renderMessage,
  type BatchSlotView,
  type BatchView,
  type CreateBatchInput,
  type PublicBatch,
  type UpdateSlotInput,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { env } from '../../config/env.js';
import { generateInviteIdentifiers, generateInviteToken } from '../../lib/inviteToken.js';
import { assertGuestCeiling, assertGuestQuota } from '../../lib/quota.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';

/**
 * Delegated distribution — «ترسل لأم العروس ٥٠ دعوة وهي ترسلها لمعازيمها».
 *
 * The host mints a block of invitations and hands over one link. The delegate
 * opens it, sees only her own block, and forwards each invitation from her own
 * phone. Nothing about the invitation itself changes: each slot is a Guest with
 * its own token, its own RSVP and its own QR at the door.
 *
 * The batch token is the delegate's entire credential, which is why it is
 * minted with the same generator as an invite token rather than being the row
 * id. Anyone holding it can address that block and read nothing else — not the
 * event's other guests, not the host's dashboard.
 */

/** The batch page's own URL, which is what the host sends the delegate. */
function batchUrl(token: string): string {
  return `${env().PUBLIC_WEB_URL.replace(/\/+$/, '')}/batch/${token}`;
}

/**
 * The message the host sends their delegate.
 *
 * Written here rather than reusing the guest template: this is not an
 * invitation, it is a request to hand invitations out, and a delegate who
 * receives «يشرّفنا حضوركم» followed by fifty links has been told the wrong
 * thing about what to do with them.
 */
function delegateMessage(batch: GuestBatch, event: Event, count: number): string {
  return [
    `أهلًا ${batch.delegateName} 🌿`,
    `هذه دعوات «${event.title}» الخاصة بـ«${batch.label}» — ${count} دعوة.`,
    'افتح الرابط وأرسل لكل ضيف دعوته من جوالك:',
    batchUrl(batch.token),
  ].join('\n');
}

function toBatchView(
  batch: GuestBatch,
  event: Event,
  guests: Array<Pick<Guest, 'status'>>,
): BatchView {
  const counts = {
    total: guests.length,
    sent: guests.filter((g) => g.status !== 'NOT_SENT').length,
    confirmed: guests.filter((g) => g.status === 'CONFIRMED' || g.status === 'ATTENDED').length,
    declined: guests.filter((g) => g.status === 'DECLINED').length,
  };

  return {
    id: batch.id,
    label: batch.label,
    delegateName: batch.delegateName,
    delegatePhone: batch.delegatePhone,
    url: batchUrl(batch.token),
    whatsappUrl: buildWhatsAppLink(
      batch.delegatePhone,
      delegateMessage(batch, event, counts.total),
    ),
    sentAt: batch.sentAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    counts,
  };
}

/**
 * Mint a batch and its slots.
 *
 * Slots are created with no name and no phone: that is the entire point — the
 * host is inviting people whose numbers they do not have. Invitations are minted
 * eagerly here rather than lazily as elsewhere, because the delegate needs a
 * forwardable link for every slot the moment she opens the page.
 */
export async function createBatch(
  event: Event,
  input: CreateBatchInput,
  actorId: string,
): Promise<BatchView> {
  await assertGuestCeiling(event.id, input.count);

  // Every identifier up front, in two queries rather than two per slot.
  const [batchToken, identifiers] = await Promise.all([
    generateInviteToken(),
    generateInviteIdentifiers(event.id, input.count),
  ]);

  /*
   * One transaction, because a half-minted batch is worse than none.
   *
   * Failing partway through a loop would leave the host looking at an error
   * with forty of their fifty slots already created and eating package quota —
   * so they retry, and now there are ninety. Rolled back, a failure costs them
   * a retry and nothing else.
   *
   * `createMany` does not return rows, so the guest ids are read back inside
   * the transaction. Which identifier lands on which slot does not matter —
   * they are interchangeable, and every guest under a batch created moments ago
   * is one of ours.
   */
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.guestBatch.create({
      data: {
        eventId: event.id,
        label: input.label,
        delegateName: input.delegateName,
        delegatePhone: input.delegatePhone,
        token: batchToken,
      },
    });

    await tx.guest.createMany({
      data: identifiers.map(() => ({
        eventId: event.id,
        batchId: created.id,
        // No name and no phone: that is the whole point — the host is inviting
        // people whose numbers they do not have.
        name: null,
        phone: null,
        companionsAllowed: event.defaultCompanionsAllowed,
      })),
    });

    const slots = await tx.guest.findMany({
      where: { batchId: created.id },
      select: { id: true },
    });

    await tx.invitation.createMany({
      // Minted eagerly, unlike everywhere else: the delegate needs a
      // forwardable link for every slot the moment she opens the page.
      data: slots.map((slot, index) => ({
        guestId: slot.id,
        eventId: event.id,
        token: identifiers[index]!.token,
        displayCode: identifiers[index]!.displayCode,
      })),
    });

    return created;
  });

  await audit({
    action: 'batch.create',
    actorId,
    eventId: event.id,
    targetType: 'GuestBatch',
    targetId: batch.id,
    meta: { label: batch.label, count: input.count, delegate: batch.delegateName },
  });

  const guests = await prisma.guest.findMany({
    where: { batchId: batch.id },
    select: { status: true },
  });

  return toBatchView(batch, event, guests);
}

export async function listBatches(event: Event): Promise<BatchView[]> {
  const batches = await prisma.guestBatch.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
    include: { guests: { select: { status: true } } },
  });

  return batches.map((batch) => toBatchView(batch, event, batch.guests));
}

/** Stamped when the host actually hands the link over, like an invitation's `sentAt`. */
export async function markBatchSent(event: Event, batchId: string): Promise<BatchView> {
  const batch = await prisma.guestBatch.findFirst({
    // Scoped by event, so another host's batch id is simply not found.
    where: { id: batchId, eventId: event.id },
    include: { guests: { select: { status: true } } },
  });

  if (!batch) throw new NotFoundError('Batch not found', 'BATCH_NOT_FOUND');

  const updated = await prisma.guestBatch.update({
    where: { id: batch.id },
    data: { sentAt: batch.sentAt ?? new Date() },
  });

  return toBatchView(updated, event, batch.guests);
}

/**
 * Delete a batch, keeping anything real that came out of it.
 *
 * Only untouched slots are removed — a guest the delegate has already named,
 * numbered or sent to is a person now, with possibly an answer and a QR, and
 * deleting them would take an RSVP with it. Those keep their row and lose only
 * the batch link (`onDelete: SetNull`), becoming ordinary guests of the event.
 */
export async function deleteBatch(
  event: Event,
  batchId: string,
  actorId: string,
): Promise<{ removedSlots: number; keptGuests: number }> {
  const batch = await prisma.guestBatch.findFirst({ where: { id: batchId, eventId: event.id } });
  if (!batch) throw new NotFoundError('Batch not found', 'BATCH_NOT_FOUND');

  const untouched = { batchId: batch.id, status: 'NOT_SENT' as const, name: null, phone: null };

  const removed = await prisma.guest.deleteMany({ where: untouched });
  const kept = await prisma.guest.count({ where: { batchId: batch.id } });

  await prisma.guestBatch.delete({ where: { id: batch.id } });

  await audit({
    action: 'batch.delete',
    actorId,
    eventId: event.id,
    targetType: 'GuestBatch',
    targetId: batch.id,
    meta: { label: batch.label, removedSlots: removed.count, keptGuests: kept },
  });

  return { removedSlots: removed.count, keptGuests: kept };
}

/* ── The delegate's side ──────────────────────────────────────────────────── */

type LoadedBatch = GuestBatch & {
  event: Event;
  guests: Array<Guest & { invitation: { token: string; sentAt: Date | null } | null }>;
};

/**
 * Resolve a batch token.
 *
 * The same NotFoundError for every failure, for the reason the invite route
 * gives: the token is the only credential, so a distinguishable response turns
 * the endpoint into an oracle for which tokens exist.
 */
async function loadBatch(token: string): Promise<LoadedBatch> {
  const batch = await prisma.guestBatch.findUnique({
    where: { token },
    include: {
      event: true,
      guests: {
        orderBy: { createdAt: 'asc' },
        include: { invitation: { select: { token: true, sentAt: true } } },
      },
    },
  });

  if (!batch) throw new NotFoundError('Batch not found', 'BATCH_NOT_FOUND');
  return batch;
}

function toSlot(
  guest: LoadedBatch['guests'][number],
  event: Event,
  position: number,
  locale: 'ar' | 'en' = 'ar',
): BatchSlotView {
  const url = guest.invitation ? buildInviteUrl(env().PUBLIC_WEB_URL, guest.invitation.token) : '';

  // The host's own template, so a delegated invitation reads exactly like one
  // the host sent themselves — and in the language the delegate is reading the
  // page in, or an English UI would hand her an Arabic message to forward.
  const template = locale === 'en' ? event.whatsappTemplateEn : event.whatsappTemplateAr;
  const message = renderMessage(template, {
    name: guestDisplayName(guest.name, locale),
    url,
    eventTitle: event.title,
    hostName: event.hostName,
    venue: event.venueName ?? undefined,
  });

  return {
    guestId: guest.id,
    name: guest.name,
    phone: guest.phone,
    status: guest.status,
    position,
    url,
    message,
    // Only once she has given us a number to open a chat with. Without one she
    // shares or copies the message instead, which is the likelier path: she has
    // these people in her contacts, not in her head as digits.
    whatsappUrl: guest.phone && url ? buildWhatsAppLink(guest.phone, message) : null,
    sentAt: guest.invitation?.sentAt?.toISOString() ?? null,
  };
}

export async function viewBatch(token: string, locale: 'ar' | 'en' = 'ar'): Promise<PublicBatch> {
  const batch = await loadBatch(token);
  const { event } = batch;

  const slots = batch.guests.map((guest, index) => toSlot(guest, event, index + 1, locale));

  return {
    label: batch.label,
    delegateName: batch.delegateName,
    event: {
      title: event.title,
      hostName: event.hostName,
      partnerName: event.partnerName,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      venueName: event.venueName,
    },
    slots,
    counts: {
      total: slots.length,
      sent: batch.guests.filter((g) => g.status !== 'NOT_SENT').length,
      confirmed: batch.guests.filter((g) => g.status === 'CONFIRMED' || g.status === 'ATTENDED')
        .length,
    },
  };
}

/** Locate a slot within its own batch — a guest id from elsewhere is not found. */
async function loadSlot(token: string, guestId: string) {
  const batch = await loadBatch(token);
  const guest = batch.guests.find((row) => row.id === guestId);
  if (!guest) throw new NotFoundError('Invitation not found', 'BATCH_SLOT_NOT_FOUND');
  return { batch, guest };
}

/**
 * Fill in who a slot is for.
 *
 * Both fields are hers to set and reset while the slot is still unanswered. Once
 * the guest has replied the name is theirs — the door greets them by it and the
 * report counts them by it, and a delegate tidying her list afterwards must not
 * be able to reassign someone else's confirmation.
 */
export async function updateSlot(
  token: string,
  guestId: string,
  input: UpdateSlotInput,
  locale: 'ar' | 'en' = 'ar',
): Promise<BatchSlotView> {
  const { batch, guest } = await loadSlot(token, guestId);

  if (guest.status === 'CONFIRMED' || guest.status === 'DECLINED' || guest.status === 'ATTENDED') {
    throw new ConflictError('This guest has already answered', 'BATCH_SLOT_ANSWERED', {
      messageAr: 'ردّ هذا الضيف على الدعوة — ما عاد يمكن تغيير بياناته من هنا.',
    });
  }

  try {
    const updated = await prisma.guest.update({
      where: { id: guest.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
      },
      include: { invitation: { select: { token: true, sentAt: true } } },
    });

    const position = batch.guests.findIndex((row) => row.id === guest.id) + 1;
    return toSlot(updated, batch.event, position, locale);
  } catch (err) {
    // @@unique([eventId, phone]) — the number is already invited to this event,
    // possibly by the host or by another delegate.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('That number is already invited', 'GUEST_DUPLICATE', {
        messageAr: 'هذا الرقم مدعو أصلًا لهذه المناسبة.',
      });
    }
    throw err;
  }
}

/**
 * Record that she sent one.
 *
 * Same rule as the host's own send: the tap is the only signal there is, so it
 * is what marks the invitation `SENT`. The package cap is enforced here too —
 * a delegate distributing beyond what the host paid for hits the same ceiling
 * the host would.
 */
export async function markSlotSent(
  token: string,
  guestId: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<BatchSlotView> {
  const { batch, guest } = await loadSlot(token, guestId);

  await assertGuestQuota(batch.eventId);

  const now = new Date();

  await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { guestId: guest.id, sentAt: null },
      data: { sentAt: now },
    }),
    prisma.guest.updateMany({
      // Only NOT_SENT advances: a guest who already answered must not be walked
      // back because the delegate re-sent their link.
      where: { id: guest.id, status: 'NOT_SENT' },
      data: { status: 'SENT' },
    }),
  ]);

  await audit({
    action: 'batch.slot_sent',
    actorType: 'SYSTEM',
    actorId: null,
    eventId: batch.eventId,
    targetType: 'Guest',
    targetId: guest.id,
    meta: { batchId: batch.id, delegate: batch.delegateName },
  });

  const refreshed = await prisma.guest.findUniqueOrThrow({
    where: { id: guest.id },
    include: { invitation: { select: { token: true, sentAt: true } } },
  });

  const position = batch.guests.findIndex((row) => row.id === guest.id) + 1;
  return toSlot(refreshed, batch.event, position, locale);
}
