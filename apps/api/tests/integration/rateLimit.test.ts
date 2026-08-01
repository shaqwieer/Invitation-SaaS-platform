import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createUser, resetDb, uniquePhone } from '../helpers/factories.js';

beforeEach(async () => {
  await resetDb();
});

describe('auth rate limiting', () => {
  it('blocks further attempts once the window limit is reached', async () => {
    // A fresh app gets fresh counters, so the threshold is exact and this test
    // cannot be perturbed by whatever ran before it.
    const app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 3 } } });
    const body = { phone: uniquePhone(), password: 'WrongPassword1!' };

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status, `attempt ${attempt} should still be allowed`).toBe(401);
    }

    const blocked = await request(app).post('/api/auth/login').send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED');
  });

  it('reports the limit through standard headers', async () => {
    const app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 2 } } });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: uniquePhone(), password: 'WrongPassword1!' });

    expect(res.headers['ratelimit-limit'] ?? res.headers['ratelimit']).toBeDefined();
  });

  it('limits a valid credential too, so a known password cannot be sprayed', async () => {
    const app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 2 } } });
    const user = await createUser();
    const body = { phone: user.phone, password: user.plainPassword };

    await request(app).post('/api/auth/login').send(body).expect(200);
    await request(app).post('/api/auth/login').send(body).expect(200);

    const blocked = await request(app).post('/api/auth/login').send(body);
    expect(blocked.status).toBe(429);
  });

  it('applies a tighter budget to OTP requests than to logins', async () => {
    const app = createApp({
      rateLimits: {
        auth: { windowMs: 60_000, limit: 100 },
        otp: { windowMs: 60_000, limit: 2 },
      },
    });
    const user = await createUser();

    await request(app).post('/api/auth/otp/request').send({ phone: user.phone }).expect(202);
    await request(app).post('/api/auth/otp/request').send({ phone: user.phone }).expect(202);

    // Each OTP costs real money at a real gateway — this is a spend control as
    // much as a security control.
    const blocked = await request(app).post('/api/auth/otp/request').send({ phone: user.phone });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('keeps limiter state separate between app instances', async () => {
    const strict = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 1 } } });
    const body = { phone: uniquePhone(), password: 'WrongPassword1!' };

    await request(strict).post('/api/auth/login').send(body).expect(401);
    await request(strict).post('/api/auth/login').send(body).expect(429);

    const relaxed = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 50 } } });
    await request(relaxed).post('/api/auth/login').send(body).expect(401);
  });
});
