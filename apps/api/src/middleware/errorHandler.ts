import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Terminal 404 for unmatched routes — runs after every router. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found', 'ROUTE_NOT_FOUND'));
};

function translate(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError('VALIDATION_ERROR', 422, 'Validation failed', err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | undefined)?.join(', ');
        return new AppError('DUPLICATE', 409, `Already exists${target ? `: ${target}` : ''}`);
      }
      case 'P2025':
        return new AppError('NOT_FOUND', 404, 'Not found');
      case 'P2003':
        return new AppError('FK_CONSTRAINT', 409, 'Referenced record does not exist');
      default:
        break;
    }
  }

  // Anything reaching here is a bug, not a handled condition. Its message may
  // contain connection strings or row data, so it never reaches the client.
  return new AppError('INTERNAL_ERROR', 500, 'Internal server error');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = translate(err);
  const requestId = res.getHeader('x-request-id') as string | undefined;

  const context = {
    requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
  };

  if (appError.statusCode >= 500) {
    // Log the original error, not the sanitized one — the stack is the point.
    logger.error({ ...context, err }, 'request failed');
  } else {
    logger.warn(context, 'request rejected');
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };

  // Surface the real cause in non-production so a 500 is debuggable locally.
  if (appError.statusCode >= 500 && env().NODE_ENV !== 'production' && err instanceof Error) {
    body.error.details = { originalMessage: err.message };
  }

  res.status(appError.statusCode).json(body);
};
