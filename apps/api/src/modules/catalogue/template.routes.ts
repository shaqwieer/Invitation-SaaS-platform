import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

/**
 * A template's gallery artwork, served to anyone.
 *
 * Public and unauthenticated for the same reason the event card route is: an
 * `<img src>` cannot carry a bearer token, and this is a picture the operator
 * publishes precisely so that prospective customers can look at it. It is the
 * catalogue, not a secret.
 */
export function createTemplatePreviewRouter(): Router {
  const router = Router();

  router.get('/:templateId/preview', async (req, res, next) => {
    try {
      const template = await prisma.template.findUnique({
        where: { id: req.params.templateId! },
        select: { previewImageData: true, previewImageMime: true },
      });

      if (!template?.previewImageData || !template.previewImageMime) {
        res.status(404).json({ error: { code: 'NO_PREVIEW', message: 'No preview image' } });
        return;
      }

      res.setHeader('Content-Type', template.previewImageMime);
      // Safe to cache hard: the URL carries a version that changes with the bytes.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(Buffer.from(template.previewImageData));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
