import { Router } from 'express';
import {
  createOrderSchema,
  payOrderSchema,
  type CreateOrderInput,
  type PayOrderInput,
} from '@da3wa/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import * as orders from './orders.service.js';

export function createOrdersRouter(): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      res.json({ orders: await orders.listOrders(req.user!) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', validate(createOrderSchema), async (req, res, next) => {
    try {
      const body = req.body as CreateOrderInput;

      // The event comes from the body here rather than the URL, so ownership is
      // checked explicitly — the same 404-not-403 rule as requireEventOwner.
      const event = await prisma.event.findFirst({
        where: {
          id: body.eventId,
          ...(req.user!.role === 'ADMIN' ? {} : { hostId: req.user!.id }),
        },
      });
      if (!event) throw new NotFoundError('Event not found', 'EVENT_NOT_FOUND');

      const order = await orders.createOrder(req.user!, event, body);
      res.status(201).json({ order });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:orderId', async (req, res, next) => {
    try {
      res.json({ order: await orders.getOrder(req.user!, req.params.orderId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:orderId/pay', validate(payOrderSchema), async (req, res, next) => {
    try {
      const result = await orders.payOrder(
        req.user!,
        req.params.orderId!,
        (req.body as PayOrderInput).method,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
