/**
 * The operator panel.
 *
 * The boundary matters more than the features: a HOST account must reach none
 * of this, and an ADMIN must not be able to read a host's guest list or answer
 * on a guest's behalf.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  createEvent,
  createGuest,
  createUser,
  loginAs,
  resetDb,
  type Session,
} from '../helpers/factories.js';

let app: Express;
let admin: Session;
let host: Session;

const ADMIN_ROUTES = [
  ['get', '/api/admin/stats'],
  ['get', '/api/admin/users'],
  ['get', '/api/admin/events'],
  ['get', '/api/admin/packages'],
  ['get', '/api/admin/templates'],
  ['get', '/api/admin/orders'],
] as const;

beforeAll(() => {
  app = createApp({ rateLimits: { auth: { windowMs: 60_000, limit: 500 } } });
});

beforeEach(async () => {
  await resetDb();
  const [adminUser, hostUser] = await Promise.all([
    createUser({ name: 'مشرف النظام', role: 'ADMIN' }),
    createUser({ name: 'أم عبدالعزيز' }),
  ]);
  [admin, host] = await Promise.all([loginAs(app, adminUser), loginAs(app, hostUser)]);
});

describe('the role boundary', () => {
  it.each(ADMIN_ROUTES)('refuses %s %s to a host', async (method, path) => {
    const agent = request(app);
    const res = await agent[method](path).set(...host.auth());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(ADMIN_ROUTES)('refuses %s %s to an anonymous caller', async (method, path) => {
    const agent = request(app);
    const res = await agent[method](path);
    expect(res.status).toBe(401);
  });

  it('refuses a host’s write attempts too', async () => {
    const other = await createUser();

    await request(app)
      .patch(`/api/admin/users/${other.id}`)
      .set(...host.auth())
      .send({ role: 'ADMIN' })
      .expect(403);

    await request(app)
      .put('/api/admin/packages')
      .set(...host.auth())
      .send({ key: 'free', nameAr: 'مجاني', nameEn: 'Free', guestCap: 9999, priceHalalas: 0 })
      .expect(403);

    // And nothing happened.
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(unchanged.role).toBe('HOST');
    expect(await prisma.package.count()).toBe(0);
  });

  it('lets an admin in', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set(...admin.auth());
    expect(res.status).toBe(200);
  });
});

describe('users', () => {
  it('never returns a password hash', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set(...admin.auth());

    expect(res.status).toBe(200);
    // A leaked admin session should not hand over every credential digest.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$argon2');
  });

  it('searches by name and phone', async () => {
    const target = await createUser({ name: 'أبو سعد', phone: '+966551234567' });

    const byName = await request(app)
      .get('/api/admin/users')
      .query({ q: 'سعد' })
      .set(...admin.auth());
    const byPhone = await request(app)
      .get('/api/admin/users')
      .query({ q: '551234567' })
      .set(...admin.auth());

    expect(byName.body.users.map((u: { id: string }) => u.id)).toContain(target.id);
    expect(byPhone.body.users.map((u: { id: string }) => u.id)).toContain(target.id);
  });

  it('promotes and disables an account', async () => {
    const target = await createUser();

    await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set(...admin.auth())
      .send({ role: 'ADMIN', isActive: false })
      .expect(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.role).toBe('ADMIN');
    expect(updated.isActive).toBe(false);
  });

  it('refuses to let an admin lock themselves out', async () => {
    // There is no second door: an admin who demotes or disables their own
    // account can take the whole operator team with them.
    for (const body of [{ role: 'HOST' }, { isActive: false }]) {
      const res = await request(app)
        .patch(`/api/admin/users/${admin.user.id}`)
        .set(...admin.auth())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ADMIN_SELF_LOCKOUT');
    }

    const still = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(still.role).toBe('ADMIN');
    expect(still.isActive).toBe(true);
  });

  it('records the change in the audit log', async () => {
    const target = await createUser();
    await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set(...admin.auth())
      .send({ isActive: false })
      .expect(200);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.user_update', targetId: target.id },
    });
    expect(entry.actorId).toBe(admin.user.id);
  });
});

describe('events', () => {
  it('sees every tenant’s events', async () => {
    const other = await createUser();
    await Promise.all([
      createEvent(host.user.id, { title: 'زفاف' }),
      createEvent(other.id, { title: 'تخرّج' }),
    ]);

    const res = await request(app)
      .get('/api/admin/events')
      .set(...admin.auth());

    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].host).toHaveProperty('phone');
  });

  it('grants headroom without changing what the host bought', async () => {
    const event = await createEvent(host.user.id);

    await request(app)
      .patch(`/api/admin/events/${event.id}`)
      .set(...admin.auth())
      .send({ guestCapOverride: 450 })
      .expect(200);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.guestCapOverride).toBe(450);
    // The package they paid for is untouched.
    expect(updated.packageId).toBe(event.packageId);
  });

  it('offers no route into a host’s guest list', async () => {
    const event = await createEvent(host.user.id);
    await createGuest(event.id, { name: 'أ. فيصل السبيعي', phone: '+966554128830' });

    const res = await request(app)
      .get('/api/admin/events')
      .set(...admin.auth());

    // Support can see that an event has guests; it cannot see who they are or
    // reach their phone numbers from here.
    expect(res.body.events[0]._count.guests).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('فيصل');
    expect(JSON.stringify(res.body)).not.toContain('554128830');
  });
});

describe('catalogue', () => {
  it('creates and then updates a package by key', async () => {
    const body = {
      key: 'event-300',
      nameAr: 'باقة المناسبة',
      nameEn: 'Event package',
      guestCap: 300,
      priceHalalas: 44_900,
      featuresAr: ['٣٠٠ رابط دعوة شخصي'],
      isHighlighted: true,
    };

    const created = await request(app)
      .put('/api/admin/packages')
      .set(...admin.auth())
      .send(body);

    expect(created.status).toBe(200);
    expect(created.body.package.priceHalalas).toBe(44_900);

    // Upsert by key, so re-running a catalogue change is safe.
    const updated = await request(app)
      .put('/api/admin/packages')
      .set(...admin.auth())
      .send({ ...body, priceHalalas: 49_900 });

    expect(updated.body.package.id).toBe(created.body.package.id);
    expect(updated.body.package.priceHalalas).toBe(49_900);
    expect(await prisma.package.count()).toBe(1);
  });

  it('rejects a key that is not url-safe', async () => {
    const res = await request(app)
      .put('/api/admin/packages')
      .set(...admin.auth())
      .send({ key: 'باقة المناسبة', nameAr: 'أ', nameEn: 'A', guestCap: 10, priceHalalas: 0 });

    expect(res.status).toBe(422);
  });

  it('rejects a fractional price', async () => {
    // Amounts are integer halalas everywhere; 449.5 halalas is not a thing.
    const res = await request(app)
      .put('/api/admin/packages')
      .set(...admin.auth())
      .send({ key: 'x', nameAr: 'أ', nameEn: 'A', guestCap: 10, priceHalalas: 449.5 });

    expect(res.status).toBe(422);
  });

  it('upserts a template', async () => {
    const res = await request(app)
      .put('/api/admin/templates')
      .set(...admin.auth())
      .send({
        key: 'custom-upload',
        nameAr: 'تصميمك أنت',
        nameEn: 'Your own design',
        priceHalalas: 19_900,
      });

    expect(res.status).toBe(200);
    expect(res.body.template.priceHalalas).toBe(19_900);
  });

  /**
   * Deleting a package is the one irreversible action in the panel, and both
   * relations pointing at it are `SetNull` — the database would carry out a
   * delete that quietly uncaps every event on the package and erases which
   * package a paid order was for. The refusal is the feature.
   */
  describe('deleting a package', () => {
    const newPackage = (key: string) =>
      prisma.package.create({
        data: { key, nameAr: 'باقة', nameEn: 'Package', guestCap: 100, priceHalalas: 10_000 },
      });

    it('deletes one nothing points at', async () => {
      const pkg = await newPackage('unused');

      const res = await request(app)
        .delete(`/api/admin/packages/${pkg.id}`)
        .set(...admin.auth());

      expect(res.status).toBe(200);
      expect(await prisma.package.count()).toBe(0);
    });

    it('refuses one an event is on, and leaves the event capped', async () => {
      const pkg = await newPackage('in-use');
      const event = await createEvent(host.user.id);
      await prisma.event.update({ where: { id: event.id }, data: { packageId: pkg.id } });

      const res = await request(app)
        .delete(`/api/admin/packages/${pkg.id}`)
        .set(...admin.auth());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PACKAGE_IN_USE');
      expect(await prisma.package.count()).toBe(1);

      const after = await prisma.event.findUnique({ where: { id: event.id } });
      expect(after?.packageId).toBe(pkg.id);
    });

    it('refuses one an order is against', async () => {
      const pkg = await newPackage('sold');
      await prisma.order.create({
        data: {
          orderNumber: 'DW-2026-9001',
          userId: host.user.id,
          packageId: pkg.id,
          status: 'PAID',
          lineItems: [],
          subtotalHalalas: 10_000,
          vatHalalas: 1_500,
          totalHalalas: 11_500,
        },
      });

      const res = await request(app)
        .delete(`/api/admin/packages/${pkg.id}`)
        .set(...admin.auth());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PACKAGE_IN_USE');
    });

    it('rejects an unknown id rather than reporting a delete that never happened', async () => {
      const res = await request(app)
        .delete('/api/admin/packages/cmsaubs5v000bs6mw96ddfi6l')
        .set(...admin.auth());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PACKAGE_NOT_FOUND');
    });

    it('refuses a host outright', async () => {
      const pkg = await newPackage('guarded');

      const res = await request(app)
        .delete(`/api/admin/packages/${pkg.id}`)
        .set(...host.auth());

      expect(res.status).toBe(403);
      expect(await prisma.package.count()).toBe(1);
    });
  });
});

describe('stats', () => {
  it('counts the platform and its revenue', async () => {
    const event = await createEvent(host.user.id);
    await createGuest(event.id);

    const pkg = await prisma.package.create({
      data: { key: 'p', nameAr: 'أ', nameEn: 'A', guestCap: 100, priceHalalas: 10_000 },
    });
    await prisma.order.createMany({
      data: [
        {
          orderNumber: 'DW-2026-0001',
          userId: host.user.id,
          eventId: event.id,
          packageId: pkg.id,
          status: 'PAID',
          lineItems: [],
          subtotalHalalas: 10_000,
          vatHalalas: 1_500,
          totalHalalas: 11_500,
        },
        {
          orderNumber: 'DW-2026-0002',
          userId: host.user.id,
          status: 'PENDING',
          lineItems: [],
          subtotalHalalas: 10_000,
          vatHalalas: 1_500,
          totalHalalas: 11_500,
        },
      ],
    });

    const res = await request(app)
      .get('/api/admin/stats')
      .set(...admin.auth());

    expect(res.body.stats.events).toBe(1);
    expect(res.body.stats.guests).toBe(1);
    // Only settled money counts as revenue.
    expect(res.body.stats.paidOrders).toBe(1);
    expect(res.body.stats.revenueHalalas).toBe(11_500);
  });
});
