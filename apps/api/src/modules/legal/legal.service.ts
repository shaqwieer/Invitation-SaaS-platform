import {
  LEGAL_SLUGS,
  type AdminLegalDocument,
  type LegalDocumentLink,
  type LegalSlug,
  type PublicLegalDocument,
  type UpdateLegalDocumentInput,
} from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';
import { DEFAULT_LEGAL_DOCUMENTS } from './legal.content.js';

type Row = {
  slug: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  isPublished: boolean;
  sortOrder: number;
  updatedAt: Date;
};

/**
 * Create any of the three that do not exist yet.
 *
 * Seed-on-read for the same reason `getSettings` upserts: a box that ran
 * `db:deploy` without a seed — which is exactly how one of the live deployments
 * is set up — must still serve its own footer links rather than three 404s.
 *
 * `createMany` with `skipDuplicates`, not a per-row upsert. It compiles to a
 * single `ON CONFLICT DO NOTHING`, which is the only version that survives two
 * visitors opening the footer at the same instant on a fresh deploy: a
 * find-then-upsert loses that race and answers one of them a 500. That is not
 * a hypothetical — it is what the first run of the tests did.
 *
 * It never writes to a row that already exists, which is the other half of the
 * contract: an operator's rewrite must not be reverted to the shipped draft the
 * next time anyone loads a page.
 */
async function seedMissing(): Promise<void> {
  await prisma.legalDocument.createMany({ data: DEFAULT_LEGAL_DOCUMENTS, skipDuplicates: true });
}

export async function getLegalDocuments(): Promise<Row[]> {
  const rows = await prisma.legalDocument.findMany({ orderBy: { sortOrder: 'asc' } });
  // The steady state — every document present — costs one query. The insert
  // only runs on a database that is actually missing something.
  if (rows.length >= DEFAULT_LEGAL_DOCUMENTS.length) return rows;

  await seedMissing();
  return prisma.legalDocument.findMany({ orderBy: { sortOrder: 'asc' } });
}

export async function getLegalDocument(slug: LegalSlug): Promise<Row | null> {
  const existing = await prisma.legalDocument.findUnique({ where: { slug } });
  if (existing) return existing;

  await seedMissing();
  return prisma.legalDocument.findUnique({ where: { slug } });
}

export async function updateLegalDocument(slug: LegalSlug, input: UpdateLegalDocumentInput) {
  const fallback = DEFAULT_LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);

  return prisma.legalDocument.upsert({
    where: { slug },
    update: input,
    // A save on a row that somehow does not exist yet still has to land, and
    // `sortOrder` is not part of the edit form — it comes from the shipped list.
    create: { slug, sortOrder: fallback?.sortOrder ?? 0, ...input },
  });
}

/**
 * Pick the locale, falling back to Arabic when the other side is empty.
 *
 * Operators write the Arabic and leave the English for later — that is the
 * realistic case, not the exception. Without this, `/en/legal/privacy` renders a
 * title over a blank page, which reads as a broken site rather than an
 * untranslated one. Same instinct as `t()` falling back to DEFAULT_LOCALE.
 */
function pick(locale: string, ar: string, en: string): string {
  if (locale === 'en') return en.trim() ? en : ar;
  return ar.trim() ? ar : en;
}

export function toPublicLegalDocument(row: Row, locale: string): PublicLegalDocument {
  return {
    slug: row.slug as LegalSlug,
    title: pick(locale, row.titleAr, row.titleEn),
    body: pick(locale, row.bodyAr, row.bodyEn),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLegalLink(row: Row, locale: string): LegalDocumentLink {
  return { slug: row.slug as LegalSlug, title: pick(locale, row.titleAr, row.titleEn) };
}

export function toAdminLegalDocument(row: Row): AdminLegalDocument {
  return {
    slug: row.slug as LegalSlug,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    bodyAr: row.bodyAr,
    bodyEn: row.bodyEn,
    isPublished: row.isPublished,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Rows the admin panel shows, in the shipped order, drafts included. */
export async function listAdminLegalDocuments(): Promise<AdminLegalDocument[]> {
  const rows = await getLegalDocuments();
  // Anything not in LEGAL_SLUGS is a leftover from a renamed document; it is
  // kept in the database but never offered for editing.
  return rows
    .filter((row): row is Row => (LEGAL_SLUGS as readonly string[]).includes(row.slug))
    .map(toAdminLegalDocument);
}
