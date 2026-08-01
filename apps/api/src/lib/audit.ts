import type { ActorType, Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export interface AuditInput {
  action: string;
  actorType?: ActorType;
  actorId?: string | null;
  eventId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Write an audit row.
 *
 * Never throws: an audit failure must not roll back the action it describes. A
 * lost audit line is bad; a login that fails because the audit table is full is
 * worse. Failures are logged so they're still visible.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorType: input.actorType ?? 'USER',
        actorId: input.actorId ?? null,
        eventId: input.eventId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}
