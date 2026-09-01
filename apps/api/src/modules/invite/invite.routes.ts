import { Router } from 'express';
import { inviteTokenParamSchema, respondSchema, type RespondInput } from '@da3wa/shared';
import { validate } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import { renderQrPng } from '../../lib/qr.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import * as invite from './invite.service.js';

/**
 * The only unauthenticated surface in the API.
 *
 * The token *is* the credential, so everything here is rate limited: a
 * 12-character token over a 32-symbol alphabet is 60 bits, which is unguessable
 * in principle but only if an attacker cannot make unlimited attempts. The
 * limiter is what turns "unguessable" into "unguessable in practice".
 */
export function createInviteRouter(limiters: RateLimiters): Router {
  const router = Router();

  /**
   * The QR on the landing page's sample invitation.
   *
   * Registered before `/:token/qr.png` so "demo" is never read as a token — the
   * token schema would reject it anyway, and the sample would show a broken
   * image at the one moment a prospect is deciding.
   *
   * It signs nothing. The payload is the sample page's own URL, so a curious
   * scan opens the sample rather than presenting an unverifiable code at a real
   * door, and no HMAC of ours is handed out to be studied.
   */
  router.get('/demo/qr.png', limiters.inviteLookup, async (_req, res, next) => {
    try {
      const png = await renderQrPng(`${env().PUBLIC_WEB_URL.replace(/\/+$/, '')}/ar/demo`);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Disposition', 'inline; filename="da3wa-demo.png"');
      res.send(png);
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/:token',
    limiters.inviteLookup,
    validate(inviteTokenParamSchema, 'params'),
    async (req, res, next) => {
      try {
        // No-store: an invitation carries the guest's name and their answer, and
        // must not sit in a shared proxy or in the browser's back-forward cache.
        res.setHeader('Cache-Control', 'no-store, private');
        res.json(await invite.viewInvitation(req.params.token!));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:token/respond',
    limiters.rsvp,
    validate(inviteTokenParamSchema, 'params'),
    validate(respondSchema),
    async (req, res, next) => {
      try {
        res.setHeader('Cache-Control', 'no-store, private');
        const result = await invite.respond(req.params.token!, req.body as RespondInput, {
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * The card picture, for WhatsApp's link preview.
   *
   * Named by the token rather than the event so the URL can be written into
   * `og:image` from the invite page alone — the page has a token and nothing
   * else, and asking the API for the event id first would mean marking the
   * invitation opened before the guest has seen it.
   *
   * A template preview or a host's pasted URL is redirected to rather than
   * proxied: those bytes are already served by a route that knows how to cache
   * them, and copying them through here would put a third of a megabyte on the
   * event loop for every preview drawn.
   */
  router.get(
    '/:token/card',
    limiters.inviteAsset,
    validate(inviteTokenParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const artwork = await invite.cardArtworkFor(req.params.token!);

        if (!artwork) {
          res.status(404).json({ error: { code: 'NO_CARD', message: 'No card artwork' } });
          return;
        }

        if (artwork.kind === 'url') {
          res.redirect(302, artwork.url);
          return;
        }

        res.setHeader('Content-Type', artwork.mime);
        // Short and public: the artwork is the picture on an invitation every
        // guest receives, not a secret — but it is replaced when the operator
        // uploads the tailored version, and this URL carries no version to bust.
        res.setHeader('Cache-Control', 'public, max-age=600');
        res.send(Buffer.from(artwork.data));
      } catch (err) {
        next(err);
      }
    },
  );

  /** The signed payload, for clients that render the QR themselves. */
  router.get(
    '/:token/qr',
    limiters.inviteLookup,
    validate(inviteTokenParamSchema, 'params'),
    async (req, res, next) => {
      try {
        res.setHeader('Cache-Control', 'no-store, private');
        res.json(await invite.qrTokenFor(req.params.token!));
      } catch (err) {
        next(err);
      }
    },
  );

  /** «حفظ كصورة» — a downloadable PNG. */
  router.get(
    '/:token/qr.png',
    limiters.inviteLookup,
    validate(inviteTokenParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const { qrToken, displayCode } = await invite.qrTokenFor(req.params.token!);
        const png = await renderQrPng(qrToken);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Content-Disposition', `attachment; filename="da3wa-${displayCode}.png"`);
        res.send(png);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
