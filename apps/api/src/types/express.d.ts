import type { Event, User } from '@prisma/client';

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
      /** Correlation id echoed in logs and error bodies. */
      id?: string;
    }
  }
}

export {};
