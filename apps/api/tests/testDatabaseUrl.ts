import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** Load the repo-root .env if present. Absent in CI, where env comes from the runner. */
export function loadRepoEnv(): void {
  const envFile = path.join(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * Where tests write.
 *
 * Never the development database: the suite truncates every table between
 * tests, and pointing that at the seeded dev data would silently destroy it the
 * first time someone ran `npm test`. The name is derived, so getting a test
 * database is automatic rather than a setup step people forget.
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) before running the test suite.');
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '') || 'da3wa';
  if (name.endsWith('_test')) return url.toString();

  url.pathname = `/${name}_test`;
  return url.toString();
}

/** Same server, maintenance database — used only to CREATE DATABASE. */
export function maintenanceUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

export function databaseName(testUrl: string): string {
  return new URL(testUrl).pathname.replace(/^\//, '');
}

export { repoRoot };
