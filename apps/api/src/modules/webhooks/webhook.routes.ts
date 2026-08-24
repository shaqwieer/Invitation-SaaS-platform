import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { paymentProvider } from '../../services/payment/index.js';
import { settlePayment } from '../orders/orders.service.js';

/**
 * Gateway callbacks.
 *
 * Three properties matter here, and only the first is obvious:
 *
 *   1. **Authenticity** — the signature is checked over the raw bytes, because
 *      re-serializing the parsed body does not reproduce what was signed.
 *
 *   2. **Idempotency** — `(provider, providerEventId)` is unique, so a retried
 *      delivery is rejected by the database before it can double-apply a
 *      payment. Every gateway retries; most retry aggressively.
 *
 *   3. **Answering 200 to deliveries we cannot act on** — an unknown event type
 *      or an unrecognised payment is *recorded* and acknowledged, not failed.
 *      A 500 makes the gateway retry forever and eventually disable the
 *      endpoint, which is a far worse outcome than one ignored message.
 */
export function createWebhookRouter(): Router {
  const router = Router();

  router.post('/:provider', async (req, res, next) => {
    const providerName = req.params.provider!;

    try {
      const provider = paymentProvider();

      if (providerName !== provider.name) {
        logger.warn({ providerName }, 'webhook for an unconfigured provider');
        return res
          .status(404)
          .json({ error: { code: 'UNKNOWN_PROVIDER', message: 'Unknown provider' } });
      }

      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const signature = req.get('x-signature') ?? req.get('x-webhook-signature');

      if (!provider.verifySignature(rawBody, signature)) {
        logger.warn({ providerName }, 'webhook signature rejected');
        return res
          .status(401)
          .json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
      }

      const envelope = provider.parseWebhook(req.body);
      if (!envelope) {
        // Signed by us, but not a shape we understand — record and move on.
        logger.warn({ providerName }, 'webhook payload not understood');
        return res.status(202).json({ status: 'ignored' });
      }

      try {
        await prisma.webhookEvent.create({
          data: {
            provider: providerName,
            providerEventId: envelope.providerEventId,
            type: envelope.type,
            payload: (req.body ?? {}) as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Seen before. Acknowledge so the gateway stops retrying, and do not
          // touch the order — this is the whole point of the unique constraint.
          logger.info(
            { providerEventId: envelope.providerEventId },
            'duplicate webhook delivery ignored',
          );
          return res.status(200).json({ status: 'duplicate' });
        }
        throw err;
      }

      await settlePayment(envelope.providerPaymentId, envelope.status, envelope.amountHalalas);

      await prisma.webhookEvent.updateMany({
        where: { provider: providerName, providerEventId: envelope.providerEventId },
        data: { processedAt: new Date() },
      });

      return res.status(200).json({ status: 'processed' });
    } catch (err) {
      // Record the failure against the delivery so it can be replayed by hand,
      // then let the error handler answer 500 and the gateway retry.
      await prisma.webhookEvent
        .updateMany({
          where: { provider: providerName, processedAt: null },
          data: { error: err instanceof Error ? err.message.slice(0, 400) : 'unknown' },
        })
        .catch(() => undefined);

      return next(err);
    }
  });

  return router;
}
