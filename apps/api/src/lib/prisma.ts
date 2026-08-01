import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * One client per process.
 *
 * The global cache exists for `tsx watch`: each reload re-imports this module,
 * and a fresh PrismaClient per reload exhausts Postgres connections within a few
 * saves.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from '@prisma/client';
