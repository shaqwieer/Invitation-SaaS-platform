import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { NotFoundError, UnauthorizedError } from '../lib/errors.js';

/**
 * Gate every event-scoped resource on ownership.
 *
 * Two things this does deliberately:
 *
 * 1. **Scopes the query by hostId** rather than fetching then comparing. A
 *    forgotten comparison is a silent cross-tenant leak; a missing `where`
 *    clause is a compile-time-obvious change.
 *
 * 2. **Returns 404, never 403.** Answering 403 for another host's event confirms
 *    the id exists, turning id enumeration into a directory of every event on
 *    the platform. "Not yours" and "not real" must be indistinguishable.
 *
 * On success the event is attached to the request, so downstream handlers get
 * authorization and the row from one database round trip.
 */
export function requireEventOwner(paramName = 'eventId'): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const eventId = req.params[paramName];
      if (!eventId) throw new NotFoundError('Event not found', 'EVENT_NOT_FOUND');

      const event = await prisma.event.findFirst({
        where: {
          id: eventId,
          // Admins operate across tenants; hosts are pinned to their own rows.
          ...(req.user.role === 'ADMIN' ? {} : { hostId: req.user.id }),
        },
      });

      if (!event) throw new NotFoundError('Event not found', 'EVENT_NOT_FOUND');

      req.event = event;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Same guarantee for a resource reached by guest id.
 *
 * Resolves the guest through its event's owner, so a host cannot read a guest by
 * id just because they know one.
 */
export function requireGuestOwner(paramName = 'guestId'): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError();

      const guestId = req.params[paramName];
      if (!guestId) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');

      const guest = await prisma.guest.findFirst({
        where: {
          id: guestId,
          ...(req.user.role === 'ADMIN' ? {} : { event: { hostId: req.user.id } }),
        },
        include: { event: true },
      });

      if (!guest) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');

      req.event = guest.event;
      next();
    } catch (err) {
      next(err);
    }
  };
}
