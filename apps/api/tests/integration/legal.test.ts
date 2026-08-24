/**
 * The terms, privacy and refund pages.
 *
 * Two properties carry the weight here. The first is that the documents exist
 * on a database nobody seeded — `resetDb` truncates every table before each
 * test, so each of these starts from exactly the state a fresh `db:deploy`
 * leaves behind, and the footer links on the landing page have to work anyway.
 * The second is that an unpublished draft is not readable by guessing its URL.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { LEGAL_SLUGS } from '@da3wa/shared';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createUser, loginAs, resetDb, type Session } from '../helpers/factories.js';

let app: Express;
let admin: Session;
let host: Session;

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

describe('the public documents', () => {
  it('serves all three on a database that was never seeded', async () => {
    expect(await prisma.legalDocument.count()).toBe(0);

    const res = await request(app).get('/api/legal');

    expect(res.status).toBe(200);
    expect(res.body.documents.map((doc: { slug: string }) => doc.slug)).toEqual([...LEGAL_SLUGS]);
  });

  it.each(LEGAL_SLUGS)('serves %s with a real body', async (slug) => {
    const res = await request(app).get(`/api/legal/${slug}`);

    expect(res.status).toBe(200);
    expect(res.body.document.slug).toBe(slug);
    // Long enough that a stub or an empty column would fail this.
    expect(res.body.document.body.length).toBeGreaterThan(500);
    expect(res.body.document.updatedAt).toEqual(expect.any(String));
  });

  it('needs no account — this is what a visitor reads before registering', async () => {
    const res = await request(app).get('/api/legal/terms');
    expect(res.status).toBe(200);
  });

  it('answers Arabic by default and English on request', async () => {
    const [ar, en] = await Promise.all([
      request(app).get('/api/legal/privacy'),
      request(app).get('/api/legal/privacy?locale=en'),
    ]);

    expect(ar.body.document.title).toBe('سياسة الخصوصية');
    expect(en.body.document.title).toBe('Privacy Policy');
  });

  it('falls back to the Arabic when the English is left empty', async () => {
    // The realistic case: an operator writes the Arabic and never gets to the
    // English. An empty page under a title reads as a broken site.
    const saved = await request(app)
      .put('/api/admin/legal/refund')
      .set(...admin.auth())
      .send({
        titleAr: 'سياسة الاسترجاع',
        titleEn: 'Refund Policy',
        bodyAr: 'لا استرجاع بعد إرسال أول دعوة.',
        bodyEn: '',
        isPublished: true,
      });
    expect(saved.status).toBe(200);

    const res = await request(app).get('/api/legal/refund?locale=en');

    expect(res.status).toBe(200);
    expect(res.body.document.body).toBe('لا استرجاع بعد إرسال أول دعوة.');
  });

  it('404s an unknown slug', async () => {
    const res = await request(app).get('/api/legal/cookies');
    expect(res.status).toBe(404);
  });

  it('404s a draft rather than serving it, and drops it from the list', async () => {
    const saved = await request(app)
      .put('/api/admin/legal/privacy')
      .set(...admin.auth())
      .send({
        titleAr: 'سياسة الخصوصية',
        titleEn: 'Privacy Policy',
        bodyAr: 'نسخة قيد المراجعة.',
        bodyEn: '',
        isPublished: false,
      });
    expect(saved.status).toBe(200);

    const [page, list] = await Promise.all([
      request(app).get('/api/legal/privacy'),
      request(app).get('/api/legal'),
    ]);

    expect(page.status).toBe(404);
    expect(list.body.documents.map((doc: { slug: string }) => doc.slug)).toEqual([
      'terms',
      'refund',
    ]);
  });
});

describe('editing from the admin panel', () => {
  it('refuses a host and an anonymous caller', async () => {
    const asHost = await request(app)
      .get('/api/admin/legal')
      .set(...host.auth());
    const anonymous = await request(app).get('/api/admin/legal');

    expect(asHost.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it('shows drafts to an admin — otherwise one could never be finished', async () => {
    await prisma.legalDocument.create({
      data: {
        slug: 'terms',
        titleAr: 'الشروط',
        titleEn: 'Terms',
        bodyAr: 'مسودة',
        bodyEn: '',
        isPublished: false,
      },
    });

    const res = await request(app)
      .get('/api/admin/legal')
      .set(...admin.auth());

    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(3);
    expect(res.body.documents.find((doc: { slug: string }) => doc.slug === 'terms')).toMatchObject({
      isPublished: false,
      bodyAr: 'مسودة',
    });
  });

  it('saves an edit and shows it on the public page', async () => {
    const body = 'لا يُسترجع المبلغ بعد إرسال أول دعوة.\n\n## التواصل\nراسلنا.';

    const saved = await request(app)
      .put('/api/admin/legal/refund')
      .set(...admin.auth())
      .send({
        titleAr: 'سياسة الاسترجاع والإلغاء',
        titleEn: 'Refund and Cancellation',
        bodyAr: body,
        bodyEn: 'No refund once the first invitation has been sent.',
        isPublished: true,
      });

    expect(saved.status).toBe(200);

    const res = await request(app).get('/api/legal/refund');
    expect(res.body.document.title).toBe('سياسة الاسترجاع والإلغاء');
    expect(res.body.document.body).toBe(body);
  });

  it('does not revert an edit on the next read', async () => {
    // `getLegalDocuments` upserts on every read to cover an unseeded database.
    // If that upsert ever wrote on the update path, an operator's rewrite would
    // silently snap back to the shipped draft the next time anyone loaded the
    // footer — a data-loss bug nobody would report as one.
    await request(app)
      .put('/api/admin/legal/terms')
      .set(...admin.auth())
      .send({
        titleAr: 'شروط المنصة',
        titleEn: 'Platform Terms',
        bodyAr: 'نص المشغّل.',
        bodyEn: '',
        isPublished: true,
      });

    await request(app).get('/api/legal');
    await request(app).get('/api/legal');

    const res = await request(app).get('/api/legal/terms');
    expect(res.body.document.body).toBe('نص المشغّل.');
  });

  it('refuses to unpublish a document the checkout links to', async () => {
    // The footer heals itself — it renders from the published list. The consent
    // line above the pay button names these two and cannot, so unpublishing one
    // would leave a buyer's only route to what they are agreeing to at a 404.
    const results = await Promise.all(
      (['terms', 'refund'] as const).map((slug) =>
        request(app)
          .put(`/api/admin/legal/${slug}`)
          .set(...admin.auth())
          .send({
            titleAr: 'عنوان',
            titleEn: 'Title',
            bodyAr: 'نص',
            bodyEn: '',
            isPublished: false,
          }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEGAL_MUST_STAY_PUBLISHED');
    }

    // Nothing was written — the refusal must not half-apply the edit.
    const terms = await request(app).get('/api/legal/terms');
    expect(terms.status).toBe(200);
    expect(terms.body.document.title).toBe('الشروط والأحكام');
  });

  it('still allows the privacy policy to be taken down for a rewrite', async () => {
    // Nothing in a payment flow links to it, so an operator may draft in place.
    const res = await request(app)
      .put('/api/admin/legal/privacy')
      .set(...admin.auth())
      .send({
        titleAr: 'سياسة الخصوصية',
        titleEn: 'Privacy Policy',
        bodyAr: 'قيد المراجعة.',
        bodyEn: '',
        isPublished: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.document.isPublished).toBe(false);
  });

  it('rejects an unknown slug and an empty Arabic body', async () => {
    const unknown = await request(app)
      .put('/api/admin/legal/cookies')
      .set(...admin.auth())
      .send({ titleAr: 'ملفات', titleEn: 'Cookies', bodyAr: 'نص', bodyEn: '', isPublished: true });

    const empty = await request(app)
      .put('/api/admin/legal/terms')
      .set(...admin.auth())
      .send({ titleAr: 'الشروط', titleEn: 'Terms', bodyAr: '   ', bodyEn: '', isPublished: true });

    expect(unknown.status).toBe(400);
    expect(empty.status).toBe(422);
  });

  it('writes an audit entry — who changed the refund terms has to be answerable', async () => {
    await request(app)
      .put('/api/admin/legal/refund')
      .set(...admin.auth())
      .send({
        titleAr: 'سياسة الاسترجاع',
        titleEn: 'Refund Policy',
        bodyAr: 'نص جديد.',
        bodyEn: '',
        isPublished: true,
      });

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'admin.legal_update', targetType: 'LegalDocument', targetId: 'refund' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(admin.user.id);
  });
});
