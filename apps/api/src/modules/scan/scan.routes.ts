import { Router } from 'express';
import {
  checkInSchema,
  scanGateSchema,
  scanOverrideSchema,
  scanSearchSchema,
  type CheckInInput,
  type ScanGateInput,
  type ScanOverrideInput,
  type ScanSearchInput,
} from '@da3wa/shared';
import { requireScanSession } from '../../middleware/requireScanSession.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../lib/prisma.js';
import { UnauthorizedError } from '../../lib/errors.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import * as scan from './scan.service.js';
import { openGate } from './session.service.js';
import { scanLog, scanStats } from './log.service.js';

/**
 * The door's own API, mounted at /api/scan.
 *
 * Every route is authenticated by a scanner session, and the event is taken
 * from that session — never from the URL or the body. A door can only ever act
 * on its own event.
 */
export function createScanRouter(limiters: RateLimiters): Router {
  const router = Router();

  /**
   * The gate — the one route here without a session, because it is what mints
   * one. Door staff have no account, so this is reachable by anyone who knows
   * the event id; the password and a tight rate limit are what stand behind it.
   */
  router.post(
    '/gate/:eventId',
    limiters.scanGate,
    validate(scanGateSchema),
    async (req, res, next) => {
      try {
        const event = await prisma.event.findUnique({ where: { id: req.params.eventId! } });

        // Same answer for a wrong password, a closed gate and a nonexistent
        // event: none of them should tell someone outside the venue anything.
        if (!event) {
          throw new UnauthorizedError('Incorrect event password', 'SCAN_GATE_REJECTED');
        }

        const session = await openGate(event, req.body as ScanGateInput, {
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
        res.status(201).json(session);
      } catch (err) {
        next(err);
      }
    },
  );

  router.use(requireScanSession);

  router.get('/session', (req, res) => {
    res.json({
      scanUserId: req.scanUser!.id,
      displayName: req.scanUser!.displayName,
      event: {
        id: req.event!.id,
        title: req.event!.title,
        venueName: req.event!.venueName,
        startsAt: req.event!.startsAt.toISOString(),
      },
    });
  });

  /**
   * Admit a guest.
   *
   * Returns a verdict; only VALID writes. A second scan answers USED and leaves
   * the existing entry untouched.
   */
  router.post('/check-in', limiters.scan, validate(checkInSchema), async (req, res, next) => {
    try {
      res.json(await scan.checkIn(req.scanUser!, req.body as CheckInInput));
    } catch (err) {
      next(err);
    }
  });

  /** «اسمح بالدخول على أي حال» — deliberate, attributed, recorded. */
  router.post('/override', limiters.scan, validate(scanOverrideSchema), async (req, res, next) => {
    try {
      res.json(await scan.overrideCheckIn(req.scanUser!, req.body as ScanOverrideInput));
    } catch (err) {
      next(err);
    }
  });

  router.get('/search', validate(scanSearchSchema, 'query'), async (req, res, next) => {
    try {
      const { q } = req.query as unknown as ScanSearchInput;
      res.json({ guests: await scan.searchGuests(req.scanUser!, q) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/log', async (req, res, next) => {
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

  return router;
}
