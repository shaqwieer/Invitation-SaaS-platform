import { Router } from 'express';
import { isLegalSlug } from '@da3wa/shared';
import { getLegalDocument, getLegalDocuments, toLegalLink, toPublicLegalDocument } from './legal.service.js';

/**
 * The published terms, privacy and refund pages.
 *
 * Unauthenticated by necessity, not by convenience: these are the documents a
 * visitor is supposed to read *before* deciding to register, and the checkout
 * screen links to two of them in front of the pay button.
 *
 * `locale` is a query parameter rather than a header so the web app's `/ar` and
 * `/en` routes map onto it directly, and so a link can be shared in a specific
 * language.
 */
export function createLegalRouter(): Router {
  const router = Router();

  /** The footer's list. Titles only — three full policies is not a nav menu. */
  router.get('/', async (req, res, next) => {
    try {
      const locale = req.query.locale === 'en' ? 'en' : 'ar';
      const rows = await getLegalDocuments();

      res.json({ documents: rows.filter((row) => row.isPublished).map((row) => toLegalLink(row, locale)) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;
      const locale = req.query.locale === 'en' ? 'en' : 'ar';

      // An unknown slug and an unpublished draft are the same answer on
      // purpose: a draft in progress should not be discoverable by guessing.
      if (!isLegalSlug(slug)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown document' } });
        return;
      }

      const row = await getLegalDocument(slug);
      if (!row || !row.isPublished) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown document' } });
        return;
      }

      res.json({ document: toPublicLegalDocument(row, locale) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
