import { createApp } from './app.js';
import { env, loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

// Fail fast and loudly on bad configuration, before a port is opened.
try {
  loadEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const app = createApp();
const server = app.listen(env().PORT, () => {
  logger.info({ port: env().PORT, nodeEnv: env().NODE_ENV }, 'da3wa api listening');
});

/**
 * Stop accepting connections, let in-flight requests finish, then close the DB
 * pool. Without this, a deploy can cut a request off mid-transaction.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');

  const forced = setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forced.unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, 'error while closing server');
    await prisma.$disconnect().catch((e) => logger.error({ err: e }, 'prisma disconnect failed'));
    clearTimeout(forced);
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});
