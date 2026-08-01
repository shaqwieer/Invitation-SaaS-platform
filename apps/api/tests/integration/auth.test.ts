import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/tokens.js';
import { cookieValue, createUser, loginAs, resetDb, uniquePhone } from '../helpers/factories.js';

let app: Express;

beforeAll(() => {
  // Limits well above what this file issues, so only the rate-limit suite
  // exercises the limiter. The OTP budget must be raised too — its real ceiling
  // is 3 per 10 minutes, which several tests here would exhaust between them.
  app = createApp({
    rateLimits: {
      auth: { windowMs: 60_000, limit: 500 },
      otp: { windowMs: 60_000, limit: 500 },
    },
  });
});

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/register', () => {
  it('creates an account and starts a session', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'أم عبدالعزيز',
      phone: '0554128830',
      password: 'Test@12345',
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTypeOf('string');
    // Stored normalized, not as typed — this is what makes duplicate detection work.
    expect(res.body.user.phone).toBe('+966554128830');
    expect(res.body.user.role).toBe('HOST');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('sets an httpOnly refresh cookie scoped to the auth routes', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'مضيف', phone: uniquePhone(), password: 'Test@12345' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/Path=\/api\/auth/i);
  });

  it('never stores the password in plaintext', async () => {
    const phone = uniquePhone();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'مضيف', phone, password: 'Test@12345' });

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(user.passwordHash).not.toContain('Test@12345');
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects a second account on the same number', async () => {
    const phone = uniquePhone();
    const body = { name: 'مضيف', phone, password: 'Test@12345' };

    await request(app).post('/api/auth/register').send(body).expect(201);
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });

  // Annotated because the last case deliberately omits `name`; without it
  // TypeScript cannot unify the row shapes into one tuple type.
  const invalidBodies: Array<[Record<string, string>, string]> = [
    [{ name: 'م', phone: '0554128830', password: 'Test@12345' }, 'name too short'],
    [{ name: 'مضيف', phone: '05012345', password: 'Test@12345' }, 'phone too short'],
    [{ name: 'مضيف', phone: '0554128830', password: 'short' }, 'password too short'],
    [{ phone: '0554128830', password: 'Test@12345' }, 'name missing'],
  ];

  it.each(invalidBodies)('rejects invalid input (%#: %s)', async (body) => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('accepts the number in any format the guest list might hold it', async () => {
    const user = await createUser({ phone: '+966554128830' });

    for (const phone of ['0554128830', '+966554128830', '966554128830', '٠٥٥٤١٢٨٨٣٠']) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone, password: user.plainPassword });
      expect(res.status, `login with ${phone}`).toBe(200);
    }
  });

  it('gives the same answer for a wrong password and an unknown number', async () => {
    const user = await createUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ phone: user.phone, password: 'NotTheRightOne1!' });

    const unknownPhone = await request(app)
      .post('/api/auth/login')
      .send({ phone: uniquePhone(), password: 'NotTheRightOne1!' });

    // Identical status and code: the response must not reveal which numbers
    // have accounts.
    expect(wrongPassword.status).toBe(401);
    expect(unknownPhone.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownPhone.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a disabled account', async () => {
    const user = await createUser({ isActive: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: user.phone, password: user.plainPassword });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the caller', async () => {
    const user = await createUser({ name: 'أم عبدالعزيز' });
    const session = await loginAs(app, user);

    const res = await request(app).get('/api/auth/me').set(...session.auth());

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.name).toBe('أم عبدالعزيز');
  });

  it.each([
    [undefined, 'TOKEN_MISSING'],
    ['Bearer not-a-jwt', 'TOKEN_INVALID'],
    ['Basic abc123', 'TOKEN_MISSING'],
  ])('rejects %s', async (header, code) => {
    const req = request(app).get('/api/auth/me');
    if (header) req.set('Authorization', header);

    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(code);
  });

  it('rejects a token belonging to a deleted account', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);
    await prisma.user.delete({ where: { id: user.id } });

    const res = await request(app).get('/api/auth/me').set(...session.auth());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_MISSING');
  });
});

describe('POST /api/auth/refresh — rotation', () => {
  it('issues a new pair and retires the old token', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);
    const first = cookieValue(session.cookies, REFRESH_COOKIE_NAME)!;

    const res = await request(app).post('/api/auth/refresh').set('Cookie', session.cookies);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');

    const rotated = cookieValue(
      res.headers['set-cookie'] as unknown as string[],
      REFRESH_COOKIE_NAME,
    );
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(first);

    // Two rows in one family: the spent original and its successor.
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens.map((t) => t.family)).size).toBe(1);
    expect(tokens.filter((t) => t.revokedAt !== null)).toHaveLength(1);
  });

  it('detects reuse and kills the whole family', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);

    // Legitimate rotation.
    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', session.cookies);
    expect(rotated.status).toBe(200);
    const successorCookies = rotated.headers['set-cookie'] as unknown as string[];

    // Replaying the original — what a stolen cookie looks like.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', session.cookies);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    // The thief's replay must also invalidate the *legitimate* client's token,
    // because we cannot tell which of the two is the attacker.
    const afterBreach = await request(app).post('/api/auth/refresh').set('Cookie', successorCookies);
    expect(afterBreach.status).toBe(401);

    const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('clears the cookie when refresh fails, so the client stops replaying it', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`${REFRESH_COOKIE_NAME}=totally-made-up`]);

    expect(res.status).toBe(401);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cleared).toMatch(/=;|Expires=Thu, 01 Jan 1970/i);
  });

  it('rejects an expired token without treating it as reuse', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);

    await prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).post('/api/auth/refresh').set('Cookie', session.cookies);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_EXPIRED');
  });

  it('requires a cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_MISSING');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and is safe to repeat', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);

    await request(app).post('/api/auth/logout').set('Cookie', session.cookies).expect(204);

    const live = await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);

    // Idempotent — a client retrying logout must not see an error.
    await request(app).post('/api/auth/logout').set('Cookie', session.cookies).expect(204);
    await request(app).post('/api/auth/logout').expect(204);
  });

  it('makes the refresh token unusable afterwards', async () => {
    const user = await createUser();
    const session = await loginAs(app, user);

    await request(app).post('/api/auth/logout').set('Cookie', session.cookies).expect(204);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', session.cookies);
    expect(res.status).toBe(401);
  });
});

describe('OTP login', () => {
  it('answers identically for registered and unknown numbers', async () => {
    const user = await createUser();

    const known = await request(app).post('/api/auth/otp/request').send({ phone: user.phone });
    const unknown = await request(app).post('/api/auth/otp/request').send({ phone: uniquePhone() });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    // Only the real account got a code.
    expect(await prisma.otpCode.count({ where: { phone: user.phone } })).toBe(1);
  });

  it('stores the code hashed, never in the clear', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/otp/request').send({ phone: user.phone });

    const record = await prisma.otpCode.findFirstOrThrow({ where: { phone: user.phone } });
    expect(record.codeHash.startsWith('$argon2')).toBe(true);
    expect(record.consumedAt).toBeNull();
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/otp/request').send({ phone: user.phone });

    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ phone: user.phone, code: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OTP_INVALID');

    const record = await prisma.otpCode.findFirstOrThrow({ where: { phone: user.phone } });
    expect(record.attempts).toBe(1);
  });

  it('invalidates the previous code when a new one is requested', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/otp/request').send({ phone: user.phone });
    await request(app).post('/api/auth/otp/request').send({ phone: user.phone });

    const live = await prisma.otpCode.count({ where: { phone: user.phone, consumedAt: null } });
    expect(live).toBe(1);
  });
});
