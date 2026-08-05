import { hash as argonHash } from '@node-rs/argon2';
import type { Event, Prisma, User } from '@prisma/client';
import type { CreateEventInput, UpdateEventInput } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { ensureTemplateTailoring } from '../design/design.service.js';

/**
 * Re-check the date relationships against the *merged* event.
 *
 * The update schema can only compare fields present in one payload. A request
 * that sets `rsvpDeadline` alone would sail through it, because `startsAt` is
 * absent — so the rule has to be re-applied here against the stored row.
 */
function assertDateOrder(startsAt: Date, endsAt?: Date | null, rsvpDeadline?: Date | null): void {
  const issues: Record<string, string[]> = {};

  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    issues.endsAt = ['وقت الانتهاء يجب أن يكون بعد وقت البدء'];
  }
  if (rsvpDeadline && rsvpDeadline.getTime() > startsAt.getTime()) {
    issues.rsvpDeadline = ['آخر موعد للرد يجب أن يكون قبل بداية المناسبة'];
  }

  if (Object.keys(issues).length > 0) {
    throw new ValidationError({ formErrors: [], fieldErrors: issues });
  }
}

/** Referenced catalogue rows must exist and be active, or the wizard silently loses them. */
async function assertCatalogueRefs(templateId?: string | null, packageId?: string | null) {
  if (templateId) {
    const template = await prisma.template.findFirst({
      where: { id: templateId, isActive: true },
      select: { id: true },
    });
    if (!template) throw new BadRequestError('Unknown template', 'TEMPLATE_NOT_FOUND');
  }

  if (packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: packageId, isActive: true },
      select: { id: true },
    });
    if (!pkg) throw new BadRequestError('Unknown package', 'PACKAGE_NOT_FOUND');
  }
}

export const EVENT_INCLUDE = {
  template: { select: { id: true, key: true, nameAr: true, nameEn: true } },
  package: { select: { id: true, key: true, nameAr: true, guestCap: true } },
  _count: { select: { guests: true } },
} satisfies Prisma.EventInclude;

/**
 * Strip the scanner password hash before an event leaves the process.
 *
 * It is a credential digest and has no business reaching a browser — but the
 * client does need to know whether a password is set, to decide between "set a
 * door password" and "change it". Every read path routes through here rather
 * than each handler remembering to omit the field.
 */
export function toEventDto<
  T extends {
    scannerPasswordHash: string | null;
    cardImageData?: Uint8Array | null;
    cardImageMime?: string | null;
  },
>(event: T) {
  // cardImageData is dropped, not just hidden: left in, Prisma's Bytes would be
  // JSON-serialised into every event response — megabytes of base64 on a
  // payload the dashboard fetches on a timer. Clients get a URL instead.
  const { scannerPasswordHash, cardImageData, ...rest } = event;
  return {
    ...rest,
    hasScannerPassword: scannerPasswordHash !== null,
    hasCardImage: !!cardImageData && !!event.cardImageMime,
  };
}

export async function createEvent(hostId: string, input: CreateEventInput, hostPhone: string) {
  assertDateOrder(input.startsAt, input.endsAt, input.rsvpDeadline);
  await assertCatalogueRefs(input.templateId, input.packageId);

  const event = await prisma.event.create({
    data: {
      hostId,
      title: input.title,
      type: input.type,
      sectionMode: input.sectionMode,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      timezone: input.timezone,
      hostName: input.hostName,
      partnerName: input.partnerName ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueLat: input.venueLat ?? null,
      venueLng: input.venueLng ?? null,
      venueMapUrl: input.venueMapUrl ?? null,
      cardDesignMode: input.cardDesignMode,
      templateId: input.templateId ?? null,
      packageId: input.packageId ?? null,
      cardColor: input.cardColor,
      cardTitleFont: input.cardTitleFont,
      customCardUrl: input.customCardUrl ?? null,
      rsvpDeadline: input.rsvpDeadline ?? null,
      defaultCompanionsAllowed: input.defaultCompanionsAllowed,
      ...(input.whatsappTemplateAr ? { whatsappTemplateAr: input.whatsappTemplateAr } : {}),
      ...(input.whatsappTemplateEn ? { whatsappTemplateEn: input.whatsappTemplateEn } : {}),
    },
    include: EVENT_INCLUDE,
  });

  // Same rule as updateEvent: a chosen template is a request for work. The
  // wizard's design step can now settle that choice before the event exists, so
  // queueing it only on update would let a host pick a template, pay, and have
  // nothing ever reach the operator's queue.
  if (event.cardDesignMode === 'TEMPLATE' && event.templateId && event.template) {
    try {
      await ensureTemplateTailoring(event.id, event.template.nameAr, {
        id: hostId,
        phone: hostPhone,
      });
    } catch (err) {
      logger.warn({ err, eventId: event.id }, 'could not queue template tailoring');
    }
  }

  await audit({
    action: 'event.create',
    actorId: hostId,
    eventId: event.id,
    targetType: 'Event',
    targetId: event.id,
  });

  return toEventDto(event);
}

/**
 * The signed-in user's own events — always, whatever their role.
 *
 * Returning every event to an ADMIN filled the operator's sidebar with other
 * people's weddings and presented them as theirs, which is not what an admin
 * account is for. Platform-wide event oversight is `/api/admin/events`.
 */
export async function listEvents(user: Pick<User, 'id' | 'role'>) {
  const events = await prisma.event.findMany({
    where: { hostId: user.id },
    orderBy: { startsAt: 'asc' },
    include: EVENT_INCLUDE,
  });
  return events.map(toEventDto);
}

export async function getEventDetail(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE });
  if (!event) throw new NotFoundError('Event not found', 'EVENT_NOT_FOUND');
  return toEventDto(event);
}

export async function updateEvent(
  current: Event,
  input: UpdateEventInput,
  actorId: string,
  actorPhone: string,
) {
  assertDateOrder(
    input.startsAt ?? current.startsAt,
    input.endsAt === undefined ? current.endsAt : input.endsAt,
    input.rsvpDeadline === undefined ? current.rsvpDeadline : input.rsvpDeadline,
  );
  await assertCatalogueRefs(input.templateId, input.packageId);

  const { scannerPassword, ...rest } = input;

  const data: Prisma.EventUpdateInput = { ...(rest as Prisma.EventUpdateInput) };

  // Null clears the gate password, which closes the scanner entirely; a string
  // sets a new one. Absent leaves whatever is stored untouched.
  if (scannerPassword !== undefined) {
    data.scannerPasswordHash = scannerPassword === null ? null : await argonHash(scannerPassword);
  }

  const event = await prisma.event.update({
    where: { id: current.id },
    data,
    include: EVENT_INCLUDE,
  });

  /*
   * Choosing a template opens the job of adapting it.
   *
   * «بعد اختياره التصميم انا اعدل عليه بشكل يناسبه» — the pick is a request for
   * work, not the end of it, and queueing it here is what stops the operator
   * having to watch the events table to notice one. Failure is swallowed: a
   * bookkeeping row must never be the reason a host cannot save their card.
   */
  if (event.cardDesignMode === 'TEMPLATE' && event.templateId && event.template) {
    try {
      await ensureTemplateTailoring(event.id, event.template.nameAr, {
        id: actorId,
        phone: actorPhone,
      });
    } catch (err) {
      logger.warn({ err, eventId: event.id }, 'could not queue template tailoring');
    }
  }

  await audit({
    action: 'event.update',
    actorId,
    eventId: event.id,
    targetType: 'Event',
    targetId: event.id,
    meta: { fields: Object.keys(input) },
  });

  return toEventDto(event);
}

/**
 * Delete an event and everything hanging off it.
 *
 * Cascades through guests, invitations, RSVPs, check-ins and scanner sessions —
 * so a deleted event takes its guests' personal data with it, which is the
 * behaviour a host expects when they say "delete".
 */
export async function deleteEvent(event: Event, actorId: string): Promise<void> {
  await prisma.event.delete({ where: { id: event.id } });

  await audit({
    action: 'event.delete',
    actorId,
    targetType: 'Event',
    targetId: event.id,
    meta: { title: event.title },
  });
}
