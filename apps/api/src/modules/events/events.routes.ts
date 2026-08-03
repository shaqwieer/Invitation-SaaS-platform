import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../lib/errors.js';
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
import { dashboardSummary } from '../dashboard/dashboard.service.js';
import { attendanceReport } from '../reports/report.service.js';
import {
  attendanceWorkbook,
  contentDisposition,
  guestListWorkbook,
} from '../exports/export.service.js';
import * as scan from '../scan/scan.service.js';
import * as sessions from '../scan/session.service.js';
import { scanLog, scanStats } from '../scan/log.service.js';
import * as events from './events.service.js';

/** Card artwork is composited in the browser, so it has to be a raster image. */
const cardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype));
  },
});

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

  /**
   * Upload the card artwork.
   *
   * 3 MB rather than the design's 10: a wedding card at the suggested
   * 1080×1920 is a few hundred kilobytes as JPEG or WebP, and the row is read
   * on every invitation open. PDF is not accepted — a browser cannot composite
   * the guest's name over one, which is the whole point of the artwork.
   */
  router.post(
    '/:eventId/card',
    requireEventOwner(),
    cardUpload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          throw new BadRequestError('Upload a PNG, JPEG or WebP under 3 MB', 'CARD_INVALID');
        }

        const event = await prisma.event.update({
          where: { id: req.event!.id },
          data: {
            cardImageData: new Uint8Array(req.file.buffer),
            cardImageMime: req.file.mimetype,
            cardImageVersion: req.event!.cardImageVersion + 1,
          },
        });

        res.json({ event: events.toEventDto(event) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:eventId/card', requireEventOwner(), async (req, res, next) => {
    try {
      const event = await prisma.event.update({
        where: { id: req.event!.id },
        data: {
          cardImageData: null,
          cardImageMime: null,
          cardImageVersion: req.event!.cardImageVersion + 1,
        },
      });

      res.json({ event: events.toEventDto(event) });
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

  // ── Dashboard, report and exports ──────────────────────────────────────────

  /** §03. Polled by the dashboard, so it carries its own `updatedAt`. */
  router.get('/:eventId/dashboard', requireEventOwner(), async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store, private');
      res.json({ summary: await dashboardSummary(req.event!) });
    } catch (err) {
      next(err);
    }
  });

  /** §12. */
  router.get('/:eventId/report', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ report: await attendanceReport(req.event!) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:eventId/exports/guests.xlsx', requireEventOwner(), async (req, res, next) => {
    try {
      const workbook = await guestListWorkbook(req.event!);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        contentDisposition('guests.xlsx', `${req.event!.title} — قائمة الضيوف.xlsx`),
      );
      // write() streams into the response rather than buffering the whole
      // workbook, which matters at 600 guests with a slow venue connection.
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:eventId/exports/attendance.xlsx', requireEventOwner(), async (req, res, next) => {
    try {
      const report = await attendanceReport(req.event!);
      const workbook = await attendanceWorkbook(req.event!, report);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        contentDisposition('attendance.xlsx', `${req.event!.title} — تقرير الحضور.xlsx`),
      );
      await workbook.xlsx.write(res);
      res.end();
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
