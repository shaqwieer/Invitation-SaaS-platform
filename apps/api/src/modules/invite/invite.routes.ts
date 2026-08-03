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
