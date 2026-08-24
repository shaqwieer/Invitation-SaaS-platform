import { loadRepoEnv, resolveTestDatabaseUrl } from './testDatabaseUrl.js';

/**
 * Runs before any test module is imported.
 *
 * Order matters: src/lib/prisma.ts reads the environment at import time, so
 * DATABASE_URL must already point at the test database by the time anything
 * pulls it in. Nothing here may import from src/.
 */
loadRepoEnv();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.LOG_LEVEL = 'silent';

// Deterministic, and distinct — env validation rejects a shared secret.
process.env.JWT_ACCESS_SECRET ||= 'test_access_secret_0123456789';
process.env.JWT_REFRESH_SECRET ||= 'test_refresh_secret_9876543210';
process.env.QR_HMAC_SECRET ||= 'test_qr_hmac_secret_0123456789';
process.env.JWT_ACCESS_TTL ||= '15m';

// Mirrors production, where the API sits behind nginx — and behind Next for
// server-rendered invite lookups. Supertest sends no X-Forwarded-For unless a
// test sets one, so this changes nothing except making that header meaningful.
process.env.TRUST_PROXY ||= '1';

/*
 * Payments, pinned to the stub — plain assignment, not `||=`.
 *
 * `loadRepoEnv()` above reads the repo's .env, so whatever a developer has
 * configured for their own machine lands here too. The moment that file says
 * `PAYMENT_PROVIDER=moyasar`, thirteen tests across orders.test.ts and
 * design.test.ts start exercising the real gateway: `pay` reaches out to
 * Moyasar, and the webhook suite signs an HMAC the Moyasar provider does not
 * verify (it reads a token from the body instead). They fail, and they fail for
 * a reason that has nothing to do with the change under test.
 *
 * These suites are written against the stub deliberately — they cover *our*
 * settlement logic, which is provider-independent. Moyasar's own parsing,
 * signature check and status mapping have 26 dedicated tests in
 * tests/unit/moyasar.test.ts, none of which need this flag.
 *
 * The secret is pinned for the same reason and must stay in step with
 * WEBHOOK_SECRET in orders.test.ts, which signs its payloads with it.
 */
process.env.PAYMENT_PROVIDER = 'stub';
process.env.PAYMENT_WEBHOOK_SECRET = 'dev_webhook_secret';
