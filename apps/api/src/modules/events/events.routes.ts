import { Router } from 'express';
import {
  createEventSchema,
  updateEventSchema,
  type CreateEventInput,
  type UpdateEventInput,
} from '@da3wa/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requireEventOwner } from '../../middleware/requireEventOwner.js';
import { validate } from '../../middleware/validate.js';
import { getGuestQuota } from '../../lib/quota.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import { createGuestsRouter } from '../guests/guests.routes.js';
import * as scan from '../scan/scan.service.js';
import * as sessions from '../scan/session.service.js';
import { scanLog, scanStats } from '../scan/log.service.js';
import * as events from './events.service.js';

export function createEventsRouter(limiters: RateLimiters): Router {
  const router = Router();

  // Every route below is authenticated. Ownership is enforced per-event by
  // requireEventOwner; there is no path into an event that skips it.
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      res.json({ events: await events.listEvents(req.user!) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', validate(createEventSchema), async (req, res, next) => {
    try {
      const event = await events.createEvent(req.user!.id, req.body as CreateEventInput);
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:eventId', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ event: await events.getEventDetail(req.event!.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/:eventId',
    requireEventOwner(),
    validate(updateEventSchema),
    async (req, res, next) => {
      try {
        const event = await events.updateEvent(
          req.event!,
          req.body as UpdateEventInput,
          req.user!.id,
        );
        res.json({ event });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:eventId', requireEventOwner(), async (req, res, next) => {
    try {
      await events.deleteEvent(req.event!, req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /** Powers the sidebar meter («استُخدم ٢١٠ من ٣٠٠»). */
  router.get('/:eventId/quota', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ quota: await getGuestQuota(req.event!.id) });
    } catch (err) {
      next(err);
    }
  });

  // ── The door, from the host's side ─────────────────────────────────────────

  /** Who is (or was) working the door tonight. */
  router.get('/:eventId/scan/sessions', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ sessions: await sessions.listSessions(req.event!.id) });
    } catch (err) {
      next(err);
    }
  });

  /** End a session — someone went home, or the password got out. */
  router.post(
    '/:eventId/scan/sessions/:scanUserId/revoke',
    requireEventOwner(),
    async (req, res, next) => {
      try {
        await sessions.revokeSession(req.event!.id, req.params.scanUserId!, req.user!.id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:eventId/checkins', requireEventOwner(), async (req, res, next) => {
    try {
      const [stats, entries] = await Promise.all([
        scanStats(req.event!.id),
        scanLog(req.event!.id),
      ]);
      res.json({ stats, entries });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Undo a check-in.
   *
   * Host-only — the door can admit, but only the person who owns the event can
   * erase a record of who came in. Revoking frees the guest to be admitted
   * again, which is the point: it exists for mistakes.
   */
  router.delete('/:eventId/checkins/:checkInId', requireEventOwner(), async (req, res, next) => {
    try {
      await scan.revokeCheckIn(req.event!, req.params.checkInId!, req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Guest and import routes are nested so they inherit the same ownership gate.
  router.use('/:eventId/guests', createGuestsRouter(limiters));

  return router;
}
