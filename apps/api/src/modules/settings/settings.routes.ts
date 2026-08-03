import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { getSettings, toPublicBranding, SETTINGS_ID } from './settings.service.js';

/**
 * Public branding.
 *
 * Unauthenticated on purpose: the landing page, the login screen, the guest
 * invitation and the door scanner all render the logo, and three of those four
 * are reached by people who will never have an account. There is nothing here a
 * visitor does not already see rendered on the page.
 */
export function createSettingsRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ branding: toPublicBranding(await getSettings()) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The logo image itself.
   *
   * Served from the database rather than a static directory so a deploy or a
   * container rebuild cannot lose it — there is no volume to remember. Cached
   * hard because the URL carries a version that changes whenever the bytes do.
   */
  router.get('/logo', async (_req, res, next) => {
    try {
      const settings = await prisma.platformSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { logoData: true, logoMime: true },
      });

      if (!settings?.logoData || !settings.logoMime) {
        res.status(404).json({ error: { code: 'NO_LOGO', message: 'No logo uploaded' } });
        return;
      }

      res.setHeader('Content-Type', settings.logoMime);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(Buffer.from(settings.logoData));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
