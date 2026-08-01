/**
 * Application errors.
 *
 * `code` is a stable machine string the web app localizes against; `message` is
 * a developer-facing fallback and is never the thing a guest reads. Anything
 * thrown that is *not* an AppError is treated as a bug by the error handler and
 * reported as a generic 500 without leaking its message.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Distinguishes deliberate errors from crashes in the handler and logs. */
  readonly isOperational = true;

  constructor(code: string, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST', details?: unknown) {
    super(code, 400, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Validation failed') {
    super('VALIDATION_ERROR', 422, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(code, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not permitted', code = 'FORBIDDEN') {
    super(code, 403, message);
  }
}

/**
 * Also the correct response for "exists, but not yours".
 *
 * Returning 403 for another host's event confirms that the id is real, which
 * turns a guessed id into an existence oracle. Cross-tenant access is 404.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(code, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    super(code, 409, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMITED') {
    super(code, 429, message);
  }
}
