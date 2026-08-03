import { Router } from 'express';
import {
  createDesignRequestSchema,
  type CreateDesignRequestInput,
} from '@da3wa/shared';
import { requireEventOwner } from '../../middleware/requireEventOwner.js';
import { validate } from '../../middleware/validate.js';
import * as design from './design.service.js';

/**
 * The host's side of «تصميم خاص».
 *
 * Mounted under `/api/events/:eventId`, so it inherits the ownership gate that
 * every other event route goes through — there is no path to a design request
 * that does not first prove the caller owns the wedding it belongs to.
 */
export function createDesignRouter(): Router {
  // mergeParams: the eventId lives on the parent router's path.
  const router = Router({ mergeParams: true });

  router.get('/', requireEventOwner(), async (req, res, next) => {
    try {
      res.json(await design.requestsFor(req.event!.id));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    requireEventOwner(),
    validate(createDesignRequestSchema),
    async (req, res, next) => {
      try {
        const request = await design.createRequest(
          req.event!,
          req.body as CreateDesignRequestInput,
          { id: req.user!.id, phone: req.user!.phone },
        );
        res.status(201).json({ request });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/:requestId/cancel', requireEventOwner(), async (req, res, next) => {
    try {
      const request = await design.cancelRequest(
        req.event!,
        req.params.requestId!,
        req.user!.id,
      );
      res.json({ request });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
