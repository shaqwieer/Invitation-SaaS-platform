import { Router } from 'express';
import {
  adminListQuerySchema,
  adminUpdateEventSchema,
  updateUserSchema,
  upsertPackageSchema,
  upsertTemplateSchema,
  type AdminListQuery,
  type AdminUpdateEventInput,
  type PlatformStats,
  type UpdateUserInput,
  type UpsertPackageInput,
  type UpsertTemplateInput,
} from '@da3wa/shared';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../lib/prisma.js';
import { audit } from '../../lib/audit.js';
import { BadRequestError } from '../../lib/errors.js';

/**
 * The operator panel.
 *
 * Every route is ADMIN-only. Note what is *not* here: no way to read a host's
 * guest list, and no way to answer on a guest's behalf. Support can grant
 * headroom, disable an account and edit the catalogue — the personal data and
 * the guest's own word stay out of reach.
 */
export function createAdminRouter(): Router {
  const router = Router();

  router.use(requireAuth, requireRole('ADMIN'));

  // ── Overview ───────────────────────────────────────────────────────────────
  router.get('/stats', async (_req, res, next) => {
    try {
      const [users, events, guests, paid] = await Promise.all([
        prisma.user.count(),
        prisma.event.count(),
        prisma.guest.count(),
        prisma.order.aggregate({
          where: { status: 'PAID' },
          _count: { _all: true },
          _sum: { totalHalalas: true },
        }),
      ]);

      const stats: PlatformStats = {
        users,
        events,
        guests,
        paidOrders: paid._count._all,
        revenueHalalas: paid._sum.totalHalalas ?? 0,
      };
      res.json({ stats });
    } catch (err) {
      next(err);
    }
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  router.get('/users', validate(adminListQuerySchema, 'query'), async (req, res, next) => {
    try {
      const { q, page, pageSize } = req.query as unknown as AdminListQuery;
      const where = q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {};

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          // Never select passwordHash — an admin has no use for it and a leaked
          // admin session should not hand over every credential digest.
          select: {
            id: true,
            name: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
            _count: { select: { events: true, orders: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({ users, pagination: { page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:userId', validate(updateUserSchema), async (req, res, next) => {
    try {
      const input = req.body as UpdateUserInput;

      // An admin demoting or disabling themselves can lock the whole operator
      // team out of the panel — there is no second door.
      if (
        req.params.userId === req.user!.id &&
        (input.role === 'HOST' || input.isActive === false)
      ) {
        throw new BadRequestError(
          'You cannot demote or disable your own admin account',
          'ADMIN_SELF_LOCKOUT',
        );
      }

      const user = await prisma.user.update({
        where: { id: req.params.userId! },
        data: input,
        select: { id: true, name: true, phone: true, role: true, isActive: true },
      });

      await audit({
        action: 'admin.user_update',
        actorId: req.user!.id,
        targetType: 'User',
        targetId: user.id,
        meta: { fields: Object.keys(input) },
      });

      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // ── Events ─────────────────────────────────────────────────────────────────
  router.get('/events', validate(adminListQuerySchema, 'query'), async (req, res, next) => {
    try {
      const { q, page, pageSize } = req.query as unknown as AdminListQuery;
      const where = q ? { title: { contains: q, mode: 'insensitive' as const } } : {};

      const [events, total] = await Promise.all([
        prisma.event.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            title: true,
            status: true,
            startsAt: true,
            guestCapOverride: true,
            host: { select: { id: true, name: true, phone: true } },
            package: { select: { id: true, nameAr: true, guestCap: true } },
            _count: { select: { guests: true } },
          },
        }),
        prisma.event.count({ where }),
      ]);

      res.json({ events, pagination: { page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/events/:eventId', validate(adminUpdateEventSchema), async (req, res, next) => {
    try {
      const input = req.body as AdminUpdateEventInput;
      const event = await prisma.event.update({
        where: { id: req.params.eventId! },
        data: input,
        select: { id: true, title: true, status: true, guestCapOverride: true, packageId: true },
      });

      await audit({
        action: 'admin.event_update',
        actorId: req.user!.id,
        eventId: event.id,
        targetType: 'Event',
        targetId: event.id,
        meta: { fields: Object.keys(input) },
      });

      res.json({ event });
    } catch (err) {
      next(err);
    }
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  router.get('/packages', async (_req, res, next) => {
    try {
      res.json({
        packages: await prisma.package.findMany({
          orderBy: [{ sortOrder: 'asc' }, { priceHalalas: 'asc' }],
          include: { _count: { select: { events: true, orders: true } } },
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  /** Upsert by key, so re-running a catalogue change is safe. */
  router.put('/packages', validate(upsertPackageSchema), async (req, res, next) => {
    try {
      const input = req.body as UpsertPackageInput;
      const pkg = await prisma.package.upsert({
        where: { key: input.key },
        update: input,
        create: input,
      });

      await audit({
        action: 'admin.package_upsert',
        actorId: req.user!.id,
        targetType: 'Package',
        targetId: pkg.id,
        meta: { key: pkg.key, priceHalalas: pkg.priceHalalas },
      });

      res.json({ package: pkg });
    } catch (err) {
      next(err);
    }
  });

  router.get('/templates', async (_req, res, next) => {
    try {
      res.json({
        templates: await prisma.template.findMany({
          orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
          include: { _count: { select: { events: true } } },
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/templates', validate(upsertTemplateSchema), async (req, res, next) => {
    try {
      const input = req.body as UpsertTemplateInput;
      const template = await prisma.template.upsert({
        where: { key: input.key },
        update: input,
        create: input,
      });

      await audit({
        action: 'admin.template_upsert',
        actorId: req.user!.id,
        targetType: 'Template',
        targetId: template.id,
        meta: { key: template.key },
      });

      res.json({ template });
    } catch (err) {
      next(err);
    }
  });

  // ── Orders ─────────────────────────────────────────────────────────────────
  router.get('/orders', validate(adminListQuerySchema, 'query'), async (req, res, next) => {
    try {
      const { page, pageSize } = req.query as unknown as AdminListQuery;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            method: true,
            totalHalalas: true,
            currency: true,
            paidAt: true,
            createdAt: true,
            user: { select: { id: true, name: true, phone: true } },
            event: { select: { id: true, title: true } },
          },
        }),
        prisma.order.count(),
      ]);

      res.json({ orders, pagination: { page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
