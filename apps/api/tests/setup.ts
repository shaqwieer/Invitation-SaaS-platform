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
