import type { Event, Guest, ScanUser, User } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: User;
      /**
       * Set by requireEventOwner. Its presence is proof the current user is
       * allowed to touch this event, so handlers can use it without re-checking.
       */
      event?: Event;
      /**
       * Set by requireGuestInEvent. Its presence proves the guest belongs to
       * req.event, which the caller has already been authorized for.
       */
      guest?: Guest;
      /**
       * Set by requireScanSession — the person working the door. Its `eventId`
       * is the only event a scanner request may touch.
       */
      scanUser?: ScanUser;
      /** Correlation id echoed in logs and error bodies. */
      id?: string;
    }
  }
}

export {};
