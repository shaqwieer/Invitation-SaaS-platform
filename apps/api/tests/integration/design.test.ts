/**
 * The three routes to a card, and the custom-design job behind two of them.
 *
 * Four properties carry this suite:
 *
 *   1. The guest sees the artwork the host *chose*, not whichever field happens
 *      to be populated.
 *   2. A design request belongs to one event, and another host cannot see or
 *      touch it.
 *   3. The operator's quote reaches the invoice — and reaches it once, however
 *      many times the gateway delivers the settlement.
 *   4. Picking a template queues the tailoring the operator promised.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Event as EventRow } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { settlePayment } from '../../src/modules/orders/orders.service.js';
import {
  createEvent,
  createGuest,
  createUser,
  loginAs,
  resetDb,
  type Session,
} from '../helpers/factories.js';

let app: Express;
let host: Session;
let intruder: Session;
let admin: Session;
let event: EventRow;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();

  const hostUser = await createUser({ name: 'أم عبدالعزيز' });
  const otherUser = await createUser({ name: 'مضيف آخر' });
  const adminUser = await createUser({ name: 'مشغّل', role: 'ADMIN' });

  host = await loginAs(app, hostUser);
  intruder = await loginAs(app, otherUser);
  admin = await loginAs(app, adminUser);

  event = await createEvent(hostUser.id);
});

/** A template with a published preview, as the gallery would show it. */
async function seedTemplate(key = 'classic') {
  return prisma.template.create({
    data: {
      key,
      nameAr: 'كلاسيكي',
      nameEn: 'Classic',
      category: 'WEDDING',
      previewImageUrl: 'https://cdn.example.com/classic.png',
    },
  });
}

/** The public invitation, which is where every artwork decision has to land. */
async function guestSees(eventRow: EventRow): Promise<string | null> {
  const guest = await createGuest(eventRow.id);
  const invitation = await prisma.invitation.create({
    data: {
      guestId: guest.id,
      eventId: eventRow.id,
      token: `tok${Math.random().toString(36).slice(2, 12)}`,
      displayCode: `${Math.floor(1000 + Math.random() * 8999)}-11`,
    },
  });

  const res = await request(app).get(`/api/invite/${invitation.token}`);
  expect(res.status).toBe(200);
  return res.body.event.cardArtworkUrl as string | null;
}

describe('artwork follows the chosen mode', () => {
  it('shows the template preview on TEMPLATE, even with a stale upload behind it', async () => {
    const template = await seedTemplate();
    await prisma.event.update({
      where: { id: event.id },
      data: {
        cardDesignMode: 'TEMPLATE',
        templateId: template.id,
        // A URL left over from a route the host has since abandoned. Under the
        // old precedence rule this quietly won.
        customCardUrl: 'https://cdn.example.com/abandoned.png',
      },
    });

    expect(await guestSees(event)).toBe('https://cdn.example.com/classic.png');
  });

  it('shows the pasted URL on UPLOAD, and the upload over it', async () => {
    await prisma.event.update({
      where: { id: event.id },
      data: {
        cardDesignMode: 'UPLOAD',
        customCardUrl: 'https://cdn.example.com/mine.png',
      },
    });

    expect(await guestSees(event)).toBe('https://cdn.example.com/mine.png');

    await request(app)
      .post(`/api/events/${event.id}/card`)
      .set(...host.auth())
      .attach('file', PNG, { filename: 'card.png', contentType: 'image/png' })
      .expect(200);

    const reloaded = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(await guestSees(reloaded)).toContain(`/api/events/${event.id}/card`);
  });

  it('shows nothing on CUSTOM_REQUEST until the design is delivered', async () => {
    const template = await seedTemplate();
    await prisma.event.update({
      where: { id: event.id },
      data: {
        cardDesignMode: 'CUSTOM_REQUEST',
        // A template picked earlier must not stand in for a design that has not
        // been drawn yet — the host would think their custom card had arrived.
        templateId: template.id,
      },
    });

    expect(await guestSees(event)).toBeNull();
  });
});

describe('the template gallery', () => {
  it('resolves an uploaded preview to its own route, and keeps the bytes out of the listing', async () => {
    const template = await seedTemplate();

    await request(app)
      .post(`/api/admin/templates/${template.id}/preview`)
      .set(...admin.auth())
      .attach('file', PNG, { filename: 'classic.png', contentType: 'image/png' })
      .expect(200);

    const catalogue = await request(app).get('/api/catalogue').expect(200);
    const listed = catalogue.body.templates.find(
      (row: { id: string }) => row.id === template.id,
    );

    // The upload wins over the pasted URL, and arrives as a path the client
    // resolves against the API origin.
    expect(listed.previewImageUrl).toBe(`/api/templates/${template.id}/preview?v=1`);
    // Bytes must never be JSON-serialised into a listing.
    expect(JSON.stringify(listed)).not.toContain('previewImageData');

    const image = await request(app).get(`/api/templates/${template.id}/preview`).expect(200);
    expect(image.headers['content-type']).toBe('image/png');

    // Cleared, it falls back to the URL the operator pasted.
    await request(app)
      .delete(`/api/admin/templates/${template.id}/preview`)
      .set(...admin.auth())
      .expect(200);

    const after = await request(app).get('/api/catalogue').expect(200);
    expect(
      after.body.templates.find((row: { id: string }) => row.id === template.id).previewImageUrl,
    ).toBe('https://cdn.example.com/classic.png');
  });

  it('is closed to a host', async () => {
    const template = await seedTemplate();

    await request(app)
      .post(`/api/admin/templates/${template.id}/preview`)
      .set(...host.auth())
      .attach('file', PNG, { filename: 'classic.png', contentType: 'image/png' })
      .expect(403);
  });
});

describe('requesting a custom design', () => {
  it('opens a request, switches the event onto the custom route, and refuses a second', async () => {
    const first = await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({ notes: 'أخضر وذهبي، خط الثلث' });

    expect(first.status).toBe(201);
    expect(first.body.request.kind).toBe('CUSTOM');
    expect(first.body.request.status).toBe('REQUESTED');
    // Defaults to the account phone rather than asking for it again.
    expect(first.body.request.contactPhone).toBe(host.user.phone);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.cardDesignMode).toBe('CUSTOM_REQUEST');

    const second = await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({});

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DESIGN_REQUEST_OPEN');
  });

  it('lets a cancelled request be replaced', async () => {
    const created = await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({})
      .expect(201);

    await request(app)
      .post(`/api/events/${event.id}/design-request/${created.body.request.id}/cancel`)
      .set(...host.auth())
      .expect(200);

    await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({})
      .expect(201);
  });

  it('is invisible to another host', async () => {
    await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({})
      .expect(201);

    // 404 rather than 403: "not yours" and "not real" must be indistinguishable.
    await request(app)
      .get(`/api/events/${event.id}/design-request`)
      .set(...intruder.auth())
      .expect(404);
  });

  it('is out of reach for an admin through the host route', async () => {
    await request(app)
      .get(`/api/events/${event.id}/design-request`)
      .set(...admin.auth())
      .expect(404);
  });
});

describe('picking a template queues its tailoring', () => {
  it('opens one tailoring job and rewrites it when the choice changes', async () => {
    const classic = await seedTemplate('classic');
    const minimal = await seedTemplate('minimal');

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...host.auth())
      .send({ cardDesignMode: 'TEMPLATE', templateId: classic.id })
      .expect(200);

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...host.auth())
      .send({ cardDesignMode: 'TEMPLATE', templateId: minimal.id })
      .expect(200);

    const jobs = await prisma.customDesignRequest.findMany({
      where: { eventId: event.id, kind: 'TEMPLATE_TAILORING' },
    });

    // One job, naming the template they settled on — not one per click.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.notes).toContain('كلاسيكي');
  });
});

describe('the operator side', () => {
  async function openRequest(): Promise<string> {
    const res = await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({ notes: 'بريف' })
      .expect(201);
    return res.body.request.id as string;
  }

  it('is closed to a host', async () => {
    const id = await openRequest();

    await request(app)
      .patch(`/api/admin/design-requests/${id}`)
      .set(...host.auth())
      .send({ priceHalalas: 19_900 })
      .expect(403);
  });

  it('quotes a price the host can then see', async () => {
    const id = await openRequest();

    await request(app)
      .patch(`/api/admin/design-requests/${id}`)
      .set(...admin.auth())
      .send({ status: 'IN_PROGRESS', priceHalalas: 24_900, adminNotes: 'اتفقنا على الأخضر' })
      .expect(200);

    const seen = await request(app)
      .get(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .expect(200);

    expect(seen.body.custom.priceHalalas).toBe(24_900);
    expect(seen.body.custom.adminNotes).toBe('اتفقنا على الأخضر');
  });

  it('delivers the artwork into the event card, where guests see it', async () => {
    const id = await openRequest();

    const delivered = await request(app)
      .post(`/api/admin/design-requests/${id}/artwork`)
      .set(...admin.auth())
      .attach('file', PNG, { filename: 'final.png', contentType: 'image/png' })
      .expect(200);

    expect(delivered.body.request.status).toBe('DELIVERED');
    expect(delivered.body.request.deliveredAt).not.toBeNull();

    const reloaded = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(reloaded.cardDesignMode).toBe('CUSTOM_REQUEST');
    expect(await guestSees(reloaded)).toContain(`/api/events/${event.id}/card`);
  });
});

describe('billing the quoted design', () => {
  async function quotedRequest(priceHalalas: number): Promise<string> {
    const created = await request(app)
      .post(`/api/events/${event.id}/design-request`)
      .set(...host.auth())
      .send({})
      .expect(201);

    await request(app)
      .patch(`/api/admin/design-requests/${created.body.request.id}`)
      .set(...admin.auth())
      .send({ status: 'IN_PROGRESS', priceHalalas })
      .expect(200);

    return created.body.request.id as string;
  }

  async function checkout() {
    const pkg = await prisma.package.upsert({
      where: { key: 'design-test' },
      update: {},
      create: {
        key: 'design-test',
        nameAr: 'باقة',
        nameEn: 'Package',
        guestCap: 100,
        priceHalalas: 24_900,
      },
    });

    const res = await request(app)
      .post('/api/orders')
      .set(...host.auth())
      .send({ eventId: event.id, packageId: pkg.id, addonTemplateIds: [] });

    expect(res.status).toBe(201);
    return res;
  }

  it('adds the quote as a line item at the price the operator set', async () => {
    await quotedRequest(19_900);

    const res = await checkout();
    const design = res.body.order.lineItems.find((item: { key: string }) =>
      item.key.startsWith('custom-design:'),
    );

    expect(design).toBeDefined();
    expect(design.unitPrice).toBe(19_900);
    // Package + design, before VAT.
    expect(res.body.order.subtotalHalalas).toBe(24_900 + 19_900);
  });

  it('charges it once, however many times settlement is delivered', async () => {
    const requestId = await quotedRequest(19_900);
    const order = await checkout();

    await request(app)
      .post(`/api/orders/${order.body.order.id}/pay`)
      .set(...host.auth())
      .send({ method: 'MADA' })
      .expect(200);

    const billedOnce = await prisma.customDesignRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(billedOnce.billedAt).not.toBeNull();

    // A gateway retrying the callback must not move the stamp…
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.body.order.id },
    });
    await settlePayment(payment.providerPaymentId!, 'SUCCEEDED');

    const stillOnce = await prisma.customDesignRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(stillOnce.billedAt?.getTime()).toBe(billedOnce.billedAt?.getTime());

    // …and a second order for the same event must not charge for it again.
    const upgrade = await checkout();
    expect(
      upgrade.body.order.lineItems.some((item: { key: string }) =>
        item.key.startsWith('custom-design:'),
      ),
    ).toBe(false);
  });

  it('never bills a template tailoring', async () => {
    const template = await seedTemplate();

    await request(app)
      .patch(`/api/events/${event.id}`)
      .set(...host.auth())
      .send({ cardDesignMode: 'TEMPLATE', templateId: template.id })
      .expect(200);

    const job = await prisma.customDesignRequest.findFirstOrThrow({
      where: { eventId: event.id, kind: 'TEMPLATE_TAILORING' },
    });

    // Even if someone puts a figure on it, tailoring is inside the package.
    await prisma.customDesignRequest.update({
      where: { id: job.id },
      data: { status: 'IN_PROGRESS', priceHalalas: 19_900 },
    });

    const res = await checkout();
    expect(
      res.body.order.lineItems.some((item: { key: string }) =>
        item.key.startsWith('custom-design:'),
      ),
    ).toBe(false);
  });
});
