import crypto from 'node:crypto';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import {
  DEFAULT_RATE_LIMITS,
  createRateLimiters,
  type RateLimitConfig,
} from './middleware/rateLimit.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createEventsRouter } from './modules/events/events.routes.js';
import { createInviteRouter } from './modules/invite/invite.routes.js';
import { createPublicBatchRouter } from './modules/batches/batch.routes.js';
import { createCatalogueRouter } from './modules/catalogue/catalogue.routes.js';
import { createTemplatePreviewRouter } from './modules/catalogue/template.routes.js';
import { createSettingsRouter } from './modules/settings/settings.routes.js';
import { createEventCardRouter } from './modules/events/card.routes.js';
import { createScanRouter } from './modules/scan/scan.routes.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { createWebhookRouter } from './modules/webhooks/webhook.routes.js';
import { createAdminRouter } from './modules/admin/admin.routes.js';

export interface CreateAppOptions {
  /** Override limits per instance — tests use this to make a limiter trip quickly. */
  rateLimits?: Partial<RateLimitConfig>;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Must precede the rate limiters: without it, every request behind nginx
  // reports the proxy's IP and shares a single bucket.
  app.set('trust proxy', env().TRUST_PROXY);
  app.disable('x-powered-by');

  const limiters = createRateLimiters({ ...DEFAULT_RATE_LIMITS, ...options.rateLimits });

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs on the web app, which is a
      // different origin with entirely different needs.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env().WEB_ORIGIN,
      // Required for the refresh cookie to travel at all.
      credentials: true,
      // Spelled out rather than left to the library default. The app uses every
      // one of these — PATCH for event and guest edits, DELETE for removals —
      // and an implicit list is the kind of thing that reads as "probably fine"
      // right up until a browser says a method is not allowed.
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      // Ten minutes in production saves a preflight per mutation; in development
      // a short window means a restarted API is trusted again immediately rather
      // than the browser replaying a cached answer from the old process.
      maxAge: env().NODE_ENV === 'production' ? 600 : 5,
    }),
  );

  app.use((req, res, next) => {
    const id = (req.get('x-request-id') || crypto.randomUUID()).slice(0, 64);
    req.id = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { id?: string }).id ?? crypto.randomUUID(),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.use(
    express.json({
      limit: '1mb',
      // Keep the raw bytes for webhook signature verification. Doing it here
      // rather than with a separate express.raw() mount means one body parser
      // and no route-ordering trap for whoever adds the next webhook.
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Liveness probe — before rate limiting so a health check never trips it.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Webhooks sit ahead of the general limiter: gateways retry aggressively, and
  // a 429 to a payment callback is a lost activation. Their own protection is
  // the signature check plus the idempotency constraint.
  app.use('/api/webhooks', createWebhookRouter());

  app.use('/api', limiters.general);
  app.use('/api/auth', createAuthRouter(limiters));
  app.use('/api/orders', createOrdersRouter());
  app.use('/api/admin', createAdminRouter());
  // Before the authenticated events router, deliberately: the card artwork is
  // loaded by an <img> that cannot carry a bearer token, on a page guests reach
  // with no account at all.
  app.use('/api/events', createEventCardRouter());
  app.use('/api/events', createEventsRouter(limiters));
  // Packages and templates a host has to pick from. Read-only; editing stays
  // behind /api/admin.
  app.use('/api/catalogue', createCatalogueRouter());
  // Template gallery artwork. Public for the same reason the event card is: an
  // <img> carries no token, and this is a catalogue picture by definition.
  app.use('/api/templates', createTemplatePreviewRouter());
  // Branding. Public because the landing page, login, invitations and the door
  // scanner all render the logo, and most of those have no account.
  app.use('/api/settings', createSettingsRouter());
  // Public — guests reach this with no account, holding only their token.
  app.use('/api/invite', createInviteRouter(limiters));
  // Also public, and also token-only: a delegate distributing a block of
  // invitations («ضيوف أم العروس») has no account either.
  app.use('/api/batch', createPublicBatchRouter(limiters));
  // The door. Authenticated by a scanner session, not a user account.
  app.use('/api/scan', createScanRouter(limiters));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
