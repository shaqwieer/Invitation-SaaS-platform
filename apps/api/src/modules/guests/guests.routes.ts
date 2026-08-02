import { Router } from 'express';
import multer from 'multer';
import {
  bulkGuestIdsSchema,
  bulkStatusSchema,
  createGuestSchema,
  importCommitSchema,
  listGuestsQuerySchema,
  updateGuestSchema,
  type BulkGuestIdsInput,
  type BulkStatusInput,
  type CreateGuestInput,
  type ImportCommitInput,
  type ListGuestsQuery,
  type UpdateGuestInput,
} from '@da3wa/shared';
import { requireEventOwner, requireGuestInEvent } from '../../middleware/requireEventOwner.js';
import { validate } from '../../middleware/validate.js';
import { BadRequestError } from '../../lib/errors.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import * as guests from './guests.service.js';
import { buildPreview, runImport } from './import.service.js';
import { parseGuestFile } from './import.parser.js';

/**
 * Files are held in memory, never written to disk.
 *
 * An import is a few hundred KB at most, and a guest list is personal data —
 * not spilling it onto the filesystem removes a cleanup job and a class of leak.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

export function createGuestsRouter(limiters: RateLimiters): Router {
  // mergeParams exposes :eventId from the parent mount.
  const router = Router({ mergeParams: true });

  // Ownership is proven once, here, for every guest route beneath.
  router.use(requireEventOwner());

  router.get('/', validate(listGuestsQuerySchema, 'query'), async (req, res, next) => {
    try {
      res.json(await guests.listGuests(req.event!.id, req.query as unknown as ListGuestsQuery));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', validate(createGuestSchema), async (req, res, next) => {
    try {
      const guest = await guests.createGuest(
        req.event!.id,
        req.body as CreateGuestInput,
        req.user!.id,
      );
      res.status(201).json({ guest });
    } catch (err) {
      next(err);
    }
  });

  // ── Bulk and import routes come first: '/:guestId' would otherwise swallow
  //    '/import' and '/bulk-delete' as guest ids.
  router.post('/bulk-delete', validate(bulkGuestIdsSchema), async (req, res, next) => {
    try {
      const deleted = await guests.bulkDeleteGuests(
        req.event!.id,
        (req.body as BulkGuestIdsInput).guestIds,
        req.user!.id,
      );
      res.json({ deleted });
    } catch (err) {
      next(err);
    }
  });

  router.post('/bulk-status', validate(bulkStatusSchema), async (req, res, next) => {
    try {
      const body = req.body as BulkStatusInput;
      const updated = await guests.bulkSetStatus(
        req.event!.id,
        body.guestIds,
        body.status,
        req.user!.id,
      );
      res.json({ updated });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Step 1 — upload and inspect. Reads the file; writes nothing.
   *
   * Rate limited on its own budget: this is the most expensive operation an
   * authenticated host can trigger, and `general` (sized for ordinary reads) is
   * far too generous for 10 MB workbook parses.
   */
  router.post(
    '/import/parse',
    limiters.fileImport,
    upload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) throw new BadRequestError('No file uploaded', 'IMPORT_NO_FILE');

        const sheet = await parseGuestFile(req.file.buffer, req.file.originalname);
        res.json(buildPreview(sheet));
      } catch (err) {
        next(err);
      }
    },
  );

  /** Steps 2–3 — dry run behind the mapping and errors screens. */
  router.post(
    '/import/validate',
    limiters.fileImport,
    validate(importCommitSchema),
    async (req, res, next) => {
      try {
        const outcome = await runImport(
          req.event!.id,
          req.body as ImportCommitInput,
          req.user!.id,
          { dryRun: true },
        );
        res.json(outcome);
      } catch (err) {
        next(err);
      }
    },
  );

  /** Step 4 — apply. Good rows always land; bad rows come back in `errors`. */
  router.post(
    '/import/commit',
    // Not limiters.general: that instance is already mounted at /api, so adding
    // it again here would count each request twice against the same store.
    limiters.fileImport,
    validate(importCommitSchema),
    async (req, res, next) => {
      try {
        const outcome = await runImport(
          req.event!.id,
          req.body as ImportCommitInput,
          req.user!.id,
          { dryRun: false },
        );
        res.status(201).json(outcome);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:guestId', requireGuestInEvent(), async (req, res, next) => {
    try {
      res.json({ guest: await guests.getGuest(req.guest!.id) });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/:guestId',
    requireGuestInEvent(),
    validate(updateGuestSchema),
    async (req, res, next) => {
      try {
        const guest = await guests.updateGuest(
          req.guest!,
          req.body as UpdateGuestInput,
          req.user!.id,
        );
        res.json({ guest });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:guestId', requireGuestInEvent(), async (req, res, next) => {
    try {
      await guests.deleteGuest(req.guest!, req.user!.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
