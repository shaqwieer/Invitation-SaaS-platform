import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireEventOwner } from '../../middleware/requireEventOwner.js';

/**
 * Phase 1 ships only what proves the authorization pattern works; full event
 * CRUD arrives in Phase 2. The read endpoint here is what the cross-tenant test
 * exercises — the middleware is worth nothing without a route behind it.
 */
export function createEventsRouter(): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const events = await prisma.event.findMany({
        where: req.user!.role === 'ADMIN' ? {} : { hostId: req.user!.id },
        orderBy: { startsAt: 'asc' },
        include: { _count: { select: { guests: true } } },
      });
      res.json({ events });
    } catch (err) {
      next(err);
    }
  });

  // requireEventOwner has already loaded and authorized the row, so the handler
  // does no ownership work of its own.
  router.get('/:eventId', requireEventOwner(), (req, res) => {
    res.json({ event: req.event });
  });

  return router;
}
