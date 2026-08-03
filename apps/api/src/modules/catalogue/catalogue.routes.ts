import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

/**
 * The buyable catalogue, as a host sees it.
 *
 * Packages and templates were previously readable only through `/api/admin`,
 * which meant the host-facing screens that have to *choose* one — the wizard's
 * design and package steps, and the card editor — had no way to list them.
 *
 * Read-only and active-only. Editing still lives behind the admin routes; this
 * exposes exactly what a price list already exposes to anyone considering a
 * purchase, and nothing else. Note what is absent: the `_count` aggregates the
 * admin listing carries, which are internal business figures.
 */
export function createCatalogueRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const [packages, templates] = await Promise.all([
        prisma.package.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { priceHalalas: 'asc' }],
          select: {
            id: true,
            key: true,
            nameAr: true,
            nameEn: true,
            guestCap: true,
            priceHalalas: true,
            scannerSeats: true,
            featuresAr: true,
            featuresEn: true,
            isHighlighted: true,
          },
        }),
        prisma.template.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
          select: {
            id: true,
            key: true,
            nameAr: true,
            nameEn: true,
            category: true,
            previewImageUrl: true,
            priceHalalas: true,
          },
        }),
      ]);

      res.json({ packages, templates });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
