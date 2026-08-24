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
      const body = req.body as PayOrderInput;
      const result = await orders.payOrder(
        req.user!,
        req.params.orderId!,
        body.method,
        body.locale,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * "I have just come back from the gateway — did it go through?"
   *
   * A POST rather than a GET because it can settle an order, activate an event
   * and send the operator a notification. Owner-scoped like every other order
   * route, and a no-op unless the order is still pending against a real
   * provider reference, so calling it twice costs one lookup.
   */
  router.post('/:orderId/verify', async (req, res, next) => {
    try {
      res.json({ order: await orders.verifyOrderPayment(req.user!, req.params.orderId!) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
