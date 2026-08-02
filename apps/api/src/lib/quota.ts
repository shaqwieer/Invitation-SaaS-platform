import { prisma } from './prisma.js';
import { ConflictError, NotFoundError } from './errors.js';

/**
 * Absolute ceiling, independent of any package.
 *
 * Not a commercial limit — a guard so a runaway import or a scripted client
 * cannot fill the table. It sits far above the largest package (600).
 */
export const MAX_GUESTS_PER_EVENT = 5000;

export interface GuestQuota {
  /** Seats the current package allows, or null when no package is attached yet. */
  cap: number | null;
  used: number;
  /** null when uncapped. */
  remaining: number | null;
  /** True once `used` is past `cap`. */
  exceeded: boolean;
  packageName: string | null;
}

export async function getGuestQuota(eventId: string, additional = 0): Promise<GuestQuota> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      guestCapOverride: true,
      package: { select: { guestCap: true, nameAr: true } },
      _count: { select: { guests: true } },
    },
  });

  if (!event) throw new NotFoundError('Event not found', 'EVENT_NOT_FOUND');

  // An explicit override wins — support grants headroom without changing the
  // package the host actually bought.
  const cap = event.guestCapOverride ?? event.package?.guestCap ?? null;
  const used = event._count.guests + additional;

  return {
    cap,
    used,
    remaining: cap === null ? null : Math.max(0, cap - used),
    exceeded: cap !== null && used > cap,
    packageName: event.package?.nameAr ?? null,
  };
}

/**
 * Enforce the hard ceiling only.
 *
 * Going *over the package cap* is deliberately not an error here. The design's
 * import-confirm screen says «سيتجاوز باقتك الحالية (٣٠٠) — ستُطلب ترقية عند
 * الإرسال»: the host may build a list larger than they have paid for, and the
 * upgrade is demanded when they try to send invitations. Blocking here would
 * make a host who bought the wrong package unable to even assemble their list.
 *
 * The package cap is enforced on the send path (phase 3).
 */
export async function assertGuestCeiling(eventId: string, additional: number): Promise<void> {
  const used = await prisma.guest.count({ where: { eventId } });

  if (used + additional > MAX_GUESTS_PER_EVENT) {
    throw new ConflictError(
      `An event cannot hold more than ${MAX_GUESTS_PER_EVENT} guests`,
      'GUEST_CEILING_EXCEEDED',
      { ceiling: MAX_GUESTS_PER_EVENT, used, requested: additional },
    );
  }
}

/**
 * Enforce the package cap. Called before invitations go out.
 *
 * Exported now so phase 3's send path has exactly one place to call, rather
 * than reimplementing the rule next to the WhatsApp link builder.
 */
export async function assertGuestQuota(eventId: string, additional = 0): Promise<GuestQuota> {
  const quota = await getGuestQuota(eventId, additional);

  if (quota.exceeded) {
    throw new ConflictError(
      'This event has more guests than the current package allows',
      'GUEST_QUOTA_EXCEEDED',
      { cap: quota.cap, used: quota.used, packageName: quota.packageName },
    );
  }

  return quota;
}
