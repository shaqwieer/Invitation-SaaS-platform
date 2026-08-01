import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value;
}

/**
 * Authenticate the caller and attach the live user row.
 *
 * The database read on every request is deliberate: a JWT stays valid until it
 * expires, so without it a deactivated account keeps working for up to the
 * access-token TTL.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new UnauthorizedError('Missing bearer token', 'TOKEN_MISSING');

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user) throw new UnauthorizedError('Account no longer exists', 'ACCOUNT_MISSING');
    if (!user.isActive) throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Attaches the user when a token is present, but never rejects. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user?.isActive) req.user = user;
  } catch {
    // An invalid token on an optional route is simply an anonymous request.
  }
  next();
};

export function requireRole(...roles: Array<'HOST' | 'ADMIN'>): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) return next(new ForbiddenError('Insufficient role'));
    next();
  };
}
