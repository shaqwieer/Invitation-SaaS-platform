import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ValidationError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validate one part of the request and **replace it with the parsed result**.
 *
 * The replacement matters: schemas here transform as well as check (a phone
 * field returns E.164, not the digits the user typed). Handlers must read the
 * parsed value, so writing it back is what makes normalization unskippable.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(new ValidationError(result.error.flatten()));
      return;
    }

    // req.query and req.params are getter-only in Express 5; assigning through
    // defineProperty keeps this working under both major versions.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
}

/** Typed accessor so handlers don't re-cast the parsed payload. */
export function parsed<T extends ZodTypeAny>(req: unknown, source: Source = 'body'): z.infer<T> {
  return (req as Record<Source, z.infer<T>>)[source];
}
