import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

/**
 * The event's card artwork, served to anyone.
 *
 * Public on purpose and mounted *before* the authenticated events router, which
 * is the only reason this is a separate file: an `<img src>` cannot carry a
 * bearer token, so the host's own editor could not display the image either if
 * this required auth.
 *
 * Nothing is leaked by that. The artwork is the picture printed on an
 * invitation every guest receives — it is not a secret, and the event id is a
 * cuid rather than a sequential number, so the route is not enumerable.
 */
export function createEventCardRouter(): Router {
  const router = Router();

  router.get('/:eventId/card', async (req, res, next) => {
    try {
      const event = await prisma.event.findUnique({
        where: { id: req.params.eventId! },
        select: { cardImageData: true, cardImageMime: true },
      });

      if (!event?.cardImageData || !event.cardImageMime) {
        res.status(404).json({ error: { code: 'NO_CARD', message: 'No card image' } });
        return;
      }

      res.setHeader('Content-Type', event.cardImageMime);
      // Safe to cache forever: the URL carries a version that changes with the
      // bytes.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(Buffer.from(event.cardImageData));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
