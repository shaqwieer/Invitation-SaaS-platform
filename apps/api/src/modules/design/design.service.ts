import type { CustomDesignRequest, Event } from '@prisma/client';
import {
  OPEN_DESIGN_REQUEST_STATUSES,
  type AdminDesignRequestView,
  type CreateDesignRequestInput,
  type DesignRequestView,
  type UpdateDesignRequestInput,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';

/**
 * «تصميم خاص» — a design drawn for one host, priced for one host.
 *
 * The work itself happens off-platform: the operator calls the number on the
 * request, they agree what the card should be, and the finished file comes back
 * as an upload. What lives here is the part a phone call cannot hold — that the
 * job exists, what was promised, what it costs, and whether it has been
 * delivered — so a wedding three weeks out is not depending on somebody
 * remembering a WhatsApp thread.
 */

export function toDesignRequestView(request: CustomDesignRequest): DesignRequestView {
  return {
    id: request.id,
    eventId: request.eventId,
    kind: request.kind,
    status: request.status,
    notes: request.notes,
    contactPhone: request.contactPhone,
    priceHalalas: request.priceHalalas,
    adminNotes: request.adminNotes,
    billedAt: request.billedAt?.toISOString() ?? null,
    deliveredAt: request.deliveredAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

/**
 * The two jobs an event can have outstanding, one per kind.
 *
 * Both are returned rather than "the latest request", because they answer
 * different questions and a host can have moved between routes: the tailoring
 * row says whether the template they picked has been adapted yet, the custom
 * row says what their bespoke design costs and where it has got to.
 *
 * Latest by creation, not "the open one" — after delivery the host still needs
 * to see the price they were quoted and that the file arrived.
 */
export async function requestsFor(eventId: string): Promise<{
  custom: DesignRequestView | null;
  tailoring: DesignRequestView | null;
}> {
  const [custom, tailoring] = await Promise.all([
    prisma.customDesignRequest.findFirst({
      where: { eventId, kind: 'CUSTOM' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customDesignRequest.findFirst({
      where: { eventId, kind: 'TEMPLATE_TAILORING' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    custom: custom ? toDesignRequestView(custom) : null,
    tailoring: tailoring ? toDesignRequestView(tailoring) : null,
  };
}

/**
 * Open a request, and switch the event onto the custom-design route.
 *
 * A second *open* request is refused rather than queued: two live jobs for one
 * card means two operators drawing the same wedding, and the host being called
 * twice. A cancelled or delivered one does not block anything — coming back a
 * month later for a second card is a normal thing to want.
 */
export async function createRequest(
  event: Event,
  input: CreateDesignRequestInput,
  actor: { id: string; phone: string },
): Promise<DesignRequestView> {
  const open = await prisma.customDesignRequest.findFirst({
    where: { eventId: event.id, status: { in: OPEN_DESIGN_REQUEST_STATUSES } },
  });

  if (open) {
    throw new ConflictError(
      'A design request is already open for this event',
      'DESIGN_REQUEST_OPEN',
      { messageAr: 'لديك طلب تصميم مفتوح لهذه المناسبة — سنتواصل معك عليه.' },
    );
  }

  const request = await prisma.customDesignRequest.create({
    data: {
      eventId: event.id,
      kind: 'CUSTOM',
      notes: input.notes ?? null,
      // The account phone is the sensible default — it is already verified and
      // it is the number the operator would have looked up anyway.
      contactPhone: input.contactPhone ?? actor.phone,
    },
  });

  // Asking for a custom design *is* choosing the custom-design route; making the
  // host then also pick it from a radio group would be asking the same question
  // twice.
  await prisma.event.update({
    where: { id: event.id },
    data: { cardDesignMode: 'CUSTOM_REQUEST' },
  });

  await audit({
    action: 'design_request.create',
    actorId: actor.id,
    eventId: event.id,
    targetType: 'CustomDesignRequest',
    targetId: request.id,
  });

  return toDesignRequestView(request);
}

/**
 * Queue the tailoring of a chosen template.
 *
 * Picking a template is not the end of the job — «بعد اختياره التصميم انا اعدل
 * عليه بشكل يناسبه». The operator adapts the chosen design to this event's
 * names, date and colours and uploads the result, which then wins over the
 * catalogue preview. Without a row for it the operator would have to notice the
 * pick by watching the events table.
 *
 * Idempotent per template: re-saving the same choice touches nothing, and
 * switching to a different template rewrites the open row rather than opening a
 * second one — the operator should draw the template the host settled on, not
 * every one they clicked through.
 *
 * Never charged. This is the tailoring included in the package; the priced job
 * is `createRequest`'s CUSTOM.
 */
export async function ensureTemplateTailoring(
  eventId: string,
  templateLabel: string,
  actor: { id: string; phone: string },
): Promise<void> {
  const open = await prisma.customDesignRequest.findFirst({
    where: {
      eventId,
      kind: 'TEMPLATE_TAILORING',
      status: { in: OPEN_DESIGN_REQUEST_STATUSES },
    },
  });

  const notes = `القالب المختار: ${templateLabel}`;

  if (open) {
    if (open.notes === notes) return;
    await prisma.customDesignRequest.update({ where: { id: open.id }, data: { notes } });
    return;
  }

  const request = await prisma.customDesignRequest.create({
    data: {
      eventId,
      kind: 'TEMPLATE_TAILORING',
      notes,
      contactPhone: actor.phone,
    },
  });

  await audit({
    action: 'design_request.template_tailoring',
    actorId: actor.id,
    eventId,
    targetType: 'CustomDesignRequest',
    targetId: request.id,
  });
}

/** The host calling the job off before the operator has started drawing. */
export async function cancelRequest(
  event: Event,
  requestId: string,
  actorId: string,
): Promise<DesignRequestView> {
  const request = await prisma.customDesignRequest.findFirst({
    // Scoped by event, so another host's request id is simply not found.
    where: { id: requestId, eventId: event.id },
  });

  if (!request) throw new NotFoundError('Design request not found', 'DESIGN_REQUEST_NOT_FOUND');

  if (request.status === 'DELIVERED') {
    throw new ConflictError('Delivered designs cannot be cancelled', 'DESIGN_REQUEST_DELIVERED', {
      messageAr: 'تم تسليم التصميم — تواصل معنا لأي تعديل.',
    });
  }

  const updated = await prisma.customDesignRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED' },
  });

  await audit({
    action: 'design_request.cancel',
    actorId,
    eventId: event.id,
    targetType: 'CustomDesignRequest',
    targetId: request.id,
  });

  return toDesignRequestView(updated);
}

/* ── Operator side ────────────────────────────────────────────────────────── */

const ADMIN_INCLUDE = {
  event: {
    select: {
      id: true,
      title: true,
      startsAt: true,
      cardImageMime: true,
      host: { select: { id: true, name: true, phone: true } },
    },
  },
} as const;

type WithEvent = CustomDesignRequest & {
  event: {
    id: string;
    title: string;
    startsAt: Date;
    cardImageMime: string | null;
    host: { id: string; name: string; phone: string };
  };
};

function toAdminView(request: WithEvent): AdminDesignRequestView {
  return {
    ...toDesignRequestView(request),
    event: {
      id: request.event.id,
      title: request.event.title,
      startsAt: request.event.startsAt.toISOString(),
      hasCardImage: request.event.cardImageMime !== null,
      host: request.event.host,
    },
  };
}

/**
 * The operator's queue.
 *
 * Open requests first and oldest-first within them: the queue's job is to show
 * what has been waiting longest, not what arrived most recently.
 */
export async function listRequests(
  status?: CustomDesignRequest['status'],
): Promise<AdminDesignRequestView[]> {
  const requests = await prisma.customDesignRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    include: ADMIN_INCLUDE,
    take: 200,
  });

  return requests.map(toAdminView);
}

export async function updateRequest(
  requestId: string,
  input: UpdateDesignRequestInput,
  actorId: string,
): Promise<AdminDesignRequestView> {
  const existing = await prisma.customDesignRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new NotFoundError('Design request not found', 'DESIGN_REQUEST_NOT_FOUND');

  const request = await prisma.customDesignRequest.update({
    where: { id: requestId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.priceHalalas === undefined ? {} : { priceHalalas: input.priceHalalas }),
      ...(input.adminNotes === undefined ? {} : { adminNotes: input.adminNotes }),
      // Stamped when the status reaches DELIVERED, cleared if it is moved back —
      // a "delivered on" date on a job that is being redrawn is a lie.
      ...(input.status === 'DELIVERED'
        ? { deliveredAt: existing.deliveredAt ?? new Date() }
        : input.status
          ? { deliveredAt: null }
          : {}),
    },
    include: ADMIN_INCLUDE,
  });

  await audit({
    action: 'admin.design_request_update',
    actorId,
    eventId: request.eventId,
    targetType: 'CustomDesignRequest',
    targetId: request.id,
    meta: { fields: Object.keys(input), status: request.status },
  });

  return toAdminView(request);
}

/**
 * Deliver the finished artwork.
 *
 * Written into the event's existing card slot rather than a second blob column:
 * `GET /api/events/:id/card` already serves it, `resolveArtwork` already
 * prefers it, and the host's editor already displays it. A parallel storage
 * path would mean three places that can disagree about which image is the card.
 */
export async function deliverArtwork(
  requestId: string,
  file: { buffer: Buffer; mimetype: string },
  actorId: string,
): Promise<AdminDesignRequestView> {
  const existing = await prisma.customDesignRequest.findUnique({
    where: { id: requestId },
    include: { event: { select: { id: true, cardImageVersion: true } } },
  });

  if (!existing) throw new NotFoundError('Design request not found', 'DESIGN_REQUEST_NOT_FOUND');

  const now = new Date();

  const [, request] = await prisma.$transaction([
    prisma.event.update({
      where: { id: existing.eventId },
      data: {
        cardImageData: new Uint8Array(file.buffer),
        cardImageMime: file.mimetype,
        cardImageVersion: existing.event.cardImageVersion + 1,
        // Delivering the file is what makes the custom design the live card.
        cardDesignMode: 'CUSTOM_REQUEST',
      },
    }),
    prisma.customDesignRequest.update({
      where: { id: requestId },
      data: { status: 'DELIVERED', deliveredAt: existing.deliveredAt ?? now },
      include: ADMIN_INCLUDE,
    }),
  ]);

  await audit({
    action: 'admin.design_request_deliver',
    actorId,
    eventId: existing.eventId,
    targetType: 'CustomDesignRequest',
    targetId: requestId,
    meta: { mime: file.mimetype, bytes: file.buffer.length },
  });

  return toAdminView(request);
}

/**
 * The design charge owed on an event, if any.
 *
 * Quoted and not yet carried by a paid order. Read at checkout so the agreed
 * price becomes a line item — and skipped once `billedAt` is stamped, so a
 * later upgrade order for the same event cannot charge for the design twice.
 */
export async function pendingCharge(eventId: string): Promise<CustomDesignRequest | null> {
  return prisma.customDesignRequest.findFirst({
    where: {
      eventId,
      // Tailoring a chosen template is included in the package and has no price
      // to charge; only a from-scratch design does.
      kind: 'CUSTOM',
      billedAt: null,
      status: { in: ['IN_PROGRESS', 'DELIVERED'] },
      priceHalalas: { gt: 0 },
    },
    orderBy: { createdAt: 'desc' },
  });
}
