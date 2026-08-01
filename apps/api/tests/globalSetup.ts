import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  databaseName,
  loadRepoEnv,
  maintenanceUrl,
  resolveTestDatabaseUrl,
} from './testDatabaseUrl.js';

const apiDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Create the test database if it doesn't exist, then bring it to the current
 * migration. Runs once for the whole suite.
 *
 * Doing this here rather than in a README step means a fresh checkout can run
 * `npm test` and have it work.
 */
export default async function globalSetup(): Promise<void> {
  loadRepoEnv();
  const testUrl = resolveTestDatabaseUrl();
  const name = databaseName(testUrl);

  const admin = new PrismaClient({
    datasources: { db: { url: maintenanceUrl(testUrl) } },
  });

  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      name,
    );

    if (existing.length === 0) {
      // Postgres has no CREATE DATABASE IF NOT EXISTS, and the name cannot be
      // parameterised — it is derived from our own DATABASE_URL, and quoting it
      // keeps an odd database name from breaking the statement.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`[test] created database ${name}`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
