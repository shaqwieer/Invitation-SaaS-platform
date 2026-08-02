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

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Liveness probe — before rate limiting so a health check never trips it.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', limiters.general);
  app.use('/api/auth', createAuthRouter(limiters));
  app.use('/api/events', createEventsRouter(limiters));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
