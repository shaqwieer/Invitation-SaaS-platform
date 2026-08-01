import { Router, type Request } from 'express';
import {
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  registerSchema,
  type LoginInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RegisterInput,
} from '@da3wa/shared';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { UnauthorizedError } from '../../lib/errors.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import * as authService from './auth.service.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  type RefreshMeta,
} from './tokens.js';

function metaFrom(req: Request): RefreshMeta {
  return { userAgent: req.get('user-agent'), ip: req.ip };
}

export function createAuthRouter(limiters: RateLimiters): Router {
  const router = Router();

  router.post('/register', limiters.auth, validate(registerSchema), async (req, res, next) => {
    try {
      const session = await authService.register(req.body as RegisterInput, metaFrom(req));
      setRefreshCookie(res, session.refreshRaw);
      res.status(201).json({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', limiters.auth, validate(loginSchema), async (req, res, next) => {
    try {
      const session = await authService.login(req.body as LoginInput, metaFrom(req));
      setRefreshCookie(res, session.refreshRaw);
      res.json({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Exchange the refresh cookie for a new access token.
   *
   * On any failure the cookie is cleared, so a client holding a reused or
   * expired token stops replaying it and is pushed to a real login.
   */
  router.post('/refresh', limiters.auth, async (req, res, next) => {
    try {
      const raw = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!raw) throw new UnauthorizedError('Missing refresh token', 'REFRESH_MISSING');

      const result = await rotateRefreshToken(raw, metaFrom(req));
      setRefreshCookie(res, result.refreshRaw);
      res.json({
        user: authService.toAuthUser(result.user),
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      });
    } catch (err) {
      clearRefreshCookie(res);
      next(err);
    }
  });

  /** Idempotent — logging out twice, or with no cookie, still succeeds. */
  router.post('/logout', async (req, res, next) => {
    try {
      const raw = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (raw) await revokeRefreshToken(raw);
      clearRefreshCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: authService.toAuthUser(req.user!) });
  });

  router.post('/otp/request', limiters.otp, validate(otpRequestSchema), async (req, res, next) => {
    try {
      await authService.requestOtp((req.body as OtpRequestInput).phone);
      // Always 202, so the response never reveals whether the number is registered.
      res.status(202).json({ status: 'sent' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/otp/verify', limiters.auth, validate(otpVerifySchema), async (req, res, next) => {
    try {
      const { phone, code } = req.body as OtpVerifyInput;
      const session = await authService.verifyOtp(phone, code, metaFrom(req));
      setRefreshCookie(res, session.refreshRaw);
      res.json({
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
