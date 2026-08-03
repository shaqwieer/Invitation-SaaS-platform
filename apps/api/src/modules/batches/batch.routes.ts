import { Router } from 'express';
import {
  batchSlotParamsSchema,
  batchTokenParamSchema,
  createBatchSchema,
  updateSlotSchema,
  type CreateBatchInput,
  type UpdateSlotInput,
} from '@da3wa/shared';
import { requireEventOwner } from '../../middleware/requireEventOwner.js';
import { validate } from '../../middleware/validate.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import * as batches from './batch.service.js';

/**
 * The delegate reads the page in one language and forwards a message in the
 * same one. Anything unrecognised falls back to Arabic, the product's first.
 */
function langOf(value: unknown): 'ar' | 'en' {
  return value === 'en' ? 'en' : 'ar';
}

/**
 * The host's side: minting a block and handing it over.
 *
 * Mounted under `/api/events/:eventId`, so it inherits the ownership gate every
 * other event route goes through.
 */
export function createEventBatchRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ batches: await batches.listBatches(req.event!) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireEventOwner(), validate(createBatchSchema), async (req, res, next) => {
    try {
      const batch = await batches.createBatch(
        req.event!,
        req.body as CreateBatchInput,
        req.user!.id,
      );
      res.status(201).json({ batch });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:batchId/sent', requireEventOwner(), async (req, res, next) => {
    try {
      res.json({ batch: await batches.markBatchSent(req.event!, req.params.batchId!) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:batchId', requireEventOwner(), async (req, res, next) => {
    try {
      res.json(await batches.deleteBatch(req.event!, req.params.batchId!, req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * The delegate's side. Unauthenticated — the token is the whole credential.
 *
 * Rate limited exactly like `/api/invite` and for the same reason: an
 * unguessable token is only unguessable in practice if guessing is bounded.
 *
 * Note what is absent. There is no route here that reads the event's other
 * guests, no dashboard, and no way to reach a slot outside the batch the token
 * names — the delegate was handed one block, not the wedding.
 */
export function createPublicBatchRouter(limiters: RateLimiters): Router {
  const router = Router();

  router.get(
    '/:token',
    limiters.inviteLookup,
    validate(batchTokenParamSchema, 'params'),
    async (req, res, next) => {
      try {
        // The page lists named guests and their numbers; it must not sit in a
        // shared proxy or the back-forward cache.
        res.setHeader('Cache-Control', 'no-store, private');
        res.json({ batch: await batches.viewBatch(req.params.token!, langOf(req.query.lang)) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/:token/slots/:guestId',
    limiters.rsvp,
    validate(batchSlotParamsSchema, 'params'),
    validate(updateSlotSchema),
    async (req, res, next) => {
      try {
        res.setHeader('Cache-Control', 'no-store, private');
        const slot = await batches.updateSlot(
          req.params.token!,
          req.params.guestId!,
          req.body as UpdateSlotInput,
          langOf(req.query.lang),
        );
        res.json({ slot });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:token/slots/:guestId/sent',
    limiters.rsvp,
    validate(batchSlotParamsSchema, 'params'),
    async (req, res, next) => {
      try {
        res.setHeader('Cache-Control', 'no-store, private');
        const slot = await batches.markSlotSent(req.params.token!, req.params.guestId!, langOf(req.query.lang));
        res.json({ slot });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
