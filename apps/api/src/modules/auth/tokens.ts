import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { RefreshToken, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const REFRESH_COOKIE_NAME = 'da3wa_rt';

/**
 * Scoped to the auth routes so the refresh token isn't attached to every API
 * call — a token that only travels where it's needed has far less surface to
 * leak from.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

export interface AccessTokenPayload {
  sub: string;
  role: 'HOST' | 'ADMIN';
}

export function signAccessToken(user: Pick<User, 'id' | 'role'>): {
  token: string;
  expiresIn: number;
} {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };

  const token = jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'da3wa',
    audience: 'da3wa-api',
  });

  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;

  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: 'da3wa',
      audience: 'da3wa-api',
    }) as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Invalid access token', 'TOKEN_INVALID');
  }
}

/** The raw refresh token never touches the database — only this digest does. */
function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface RefreshMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export async function issueRefreshToken(
  userId: string,
  family: string = crypto.randomUUID(),
  meta: RefreshMeta = {},
): Promise<{ raw: string; record: RefreshToken }> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  const record = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      family,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });

  return { raw, record };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Reuse detection: a token is revoked the moment it is spent. If a *revoked*
 * token is presented again, either the client replayed it or it was stolen —
 * both mean the chain is no longer trustworthy, so every token in the family
 * dies and the session ends. That bounds a stolen token's usefulness to the
 * window before the legitimate client next refreshes.
 */
export async function rotateRefreshToken(
  raw: string,
  meta: RefreshMeta = {},
): Promise<{ user: User; accessToken: string; expiresIn: number; refreshRaw: string }> {
  const tokenHash = hashToken(raw);

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
  }

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { family: existing.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: existing.userId, family: existing.family },
      'refresh token reuse detected — family revoked',
    );
    throw new UnauthorizedError('Refresh token reuse detected', 'REFRESH_REUSED');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Refresh token expired', 'REFRESH_EXPIRED');
  }

  if (!existing.user.isActive) {
    throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
  }

  const successorRaw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  // One transaction: the old token must not be spendable while its successor exists.
  await prisma.$transaction(async (tx) => {
    const successor = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashToken(successorRaw),
        family: existing.family,
        expiresAt,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      },
    });

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: successor.id },
    });
  });

  const { token, expiresIn } = signAccessToken(existing.user);
  return { user: existing.user, accessToken: token, expiresIn, refreshRaw: successorRaw };
}

/** Idempotent: logging out with an already-dead token is not an error. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setRefreshCookie(res: Response, raw: string): void {
  res.cookie(REFRESH_COOKIE_NAME, raw, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: env().JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}

/** Exported for tests that need to assert on stored rows. */
export const __testing = { hashToken };
