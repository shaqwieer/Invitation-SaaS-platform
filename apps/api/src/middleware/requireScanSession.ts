import type { RequestHandler } from 'express';
import { resolveSession, SCAN_SESSION_HEADER } from '../modules/scan/session.service.js';

/**
 * Authenticate the door.
 *
 * A scanner session is not a user account: it carries no host privileges, and
 * it can only ever touch its own event because the event comes from the session
 * row rather than from the URL. There is deliberately no request shape in which
 * a scanner can name a different event.
 */
export const requireScanSession: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.get(SCAN_SESSION_HEADER) ?? undefined;
    const scanUser = await resolveSession(header);

    req.scanUser = scanUser;
    req.event = scanUser.event;
    next();
  } catch (err) {
    next(err);
  }
};
