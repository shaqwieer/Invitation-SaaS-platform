import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { User } from '@prisma/client';
import type { AuthUser, LoginInput, RegisterInput } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from '../../lib/errors.js';
import { smsProvider } from '../../services/sms/index.js';
import { issueRefreshToken, signAccessToken, type RefreshMeta } from './tokens.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

/**
 * Pre-computed hash of a value nobody knows.
 *
 * Used to burn the same CPU on a login for a nonexistent phone as on a real one.
 * Without it, "no such user" returns in ~1ms and "wrong password" in ~50ms,
 * which is a reliable oracle for which numbers have accounts.
 */
let decoyHash: string | null = null;
async function decoy(): Promise<string> {
  decoyHash ??= await argonHash(crypto.randomBytes(32).toString('hex'));
  return decoyHash;
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    locale: user.locale,
  };
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
  refreshRaw: string;
}

async function startSession(user: User, meta: RefreshMeta): Promise<AuthSession> {
  const { token, expiresIn } = signAccessToken(user);
  const { raw } = await issueRefreshToken(user.id, undefined, meta);
  return { user: toAuthUser(user), accessToken: token, expiresIn, refreshRaw: raw };
}

export async function register(input: RegisterInput, meta: RefreshMeta): Promise<AuthSession> {
  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (existing) {
    throw new ConflictError('An account already exists for this number', 'PHONE_TAKEN');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      phone: input.phone,
      passwordHash: await argonHash(input.password),
      ...(input.locale ? { locale: input.locale } : {}),
    },
  });

  await audit({ action: 'auth.register', actorId: user.id, targetType: 'User', targetId: user.id });
  return startSession(user, meta);
}

export async function login(input: LoginInput, meta: RefreshMeta): Promise<AuthSession> {
  const user = await prisma.user.findUnique({ where: { phone: input.phone } });

  // Same work and the same error whether the phone is unknown or the password
  // is wrong — neither the timing nor the message distinguishes them.
  const passwordOk = user
    ? await argonVerify(user.passwordHash, input.password)
    : await argonVerify(await decoy(), input.password).catch(() => false);

  if (!user || !passwordOk) {
    throw new UnauthorizedError('Phone number or password is incorrect', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
  }

  await audit({ action: 'auth.login', actorId: user.id, ip: meta.ip ?? null });
  return startSession(user, meta);
}

/**
 * Send a login code.
 *
 * Always resolves, whether or not the number has an account: a 404 here would
 * turn the endpoint into a "does this person use Da3wa?" lookup. Nothing is sent
 * for unknown numbers.
 */
export async function requestOtp(phone: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.isActive) {
    logger.debug({ phone }, 'otp requested for unknown or inactive account — no message sent');
    return;
  }

  // Only the newest code should ever be valid.
  await prisma.otpCode.updateMany({
    where: { phone, purpose: 'LOGIN', consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: await argonHash(code),
      purpose: 'LOGIN',
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await smsProvider().send({
    to: phone,
    body: `رمز الدخول إلى دعوة: ${code}\nصالح لمدة ١٠ دقائق.`,
  });

  await audit({ action: 'auth.otp_requested', actorId: user.id });
}

export async function verifyOtp(
  phone: string,
  code: string,
  meta: RefreshMeta,
): Promise<AuthSession> {
  const record = await prisma.otpCode.findFirst({
    where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    throw new UnauthorizedError('Code is invalid or has expired', 'OTP_INVALID');
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    // Consume it so a fresh code is required rather than leaving a burnt one
    // around to be hammered further.
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new TooManyRequestsError('Too many incorrect attempts', 'OTP_ATTEMPTS_EXCEEDED');
  }

  if (!(await argonVerify(record.codeHash, code))) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new UnauthorizedError('Code is invalid or has expired', 'OTP_INVALID');
  }

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() },
    }),
  ]);

  await audit({ action: 'auth.login_otp', actorId: user.id, ip: meta.ip ?? null });
  return startSession(user, meta);
}
