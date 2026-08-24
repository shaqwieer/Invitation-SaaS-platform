import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isLegalSlug, LEGAL_SLUGS } from '@da3wa/shared';
import { fetchLegalDocument, fetchLegalLinks } from '@/lib/api.server';
import { Logo } from '@/components/Logo';
import { LegalBody } from '@/components/LegalBody';
import { DEFAULT_LOCALE, isLocale, t, type AppLocale } from '@/lib/i18n';

/**
 * The terms, privacy and refund pages.
 *
 * One route for all three: they differ only in their text, and three near-
 * identical files would drift apart the first time one of them was restyled.
 *
 * `force-dynamic` and no `generateStaticParams`, deliberately. The text is
 * edited from the admin panel, and a statically rendered copy would mean an
 * operator corrects a refund clause, reloads, and reads the old one — the same
 * trap `fetchBranding` documents. Both fetches are `no-store` for that reason;
 * this only stops the build from freezing the page before they ever run.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string; slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  if (!isLegalSlug(params.slug)) return {};

  const document = await fetchLegalDocument(params.slug, locale);
  return document ? { title: document.title } : {};
}

export default async function LegalPage({ params }: PageProps) {
  if (!isLocale(params.locale)) notFound();
  const locale: AppLocale = params.locale;
  const tr = (key: string) => t(locale, key);

  // Guard before the fetch: an unknown slug is a 404 whatever the API says, and
  // there is no reason to ask it about `/legal/../../admin`.
  if (!isLegalSlug(params.slug)) notFound();

  const [document, links] = await Promise.all([
    fetchLegalDocument(params.slug, locale),
    fetchLegalLinks(locale),
  ]);

  // Covers both an unknown document and one an operator has unpublished while
  // rewriting it. A draft should not be readable by anyone who guesses the URL.
  if (!document) notFound();

  const other = locale === 'ar' ? 'en' : 'ar';
  const updated = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-arab' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(document.updatedAt));

  // Ordered by the canonical list rather than by whatever the API returned, so
  // the three side links read the same on every page.
  const siblings = LEGAL_SLUGS.map((slug) => links.find((link) => link.slug === slug)).filter(
    (link): link is NonNullable<typeof link> => Boolean(link),
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3.5 lg:px-8">
          <Logo locale={locale} href={`/${locale}`} size="xl" showName={false} />

          <div className="ms-auto flex items-center gap-2.5">
            {/* Keeps the reader on the same document when they switch language,
                rather than dropping them on the landing page. */}
            <Link
              href={`/${other}/legal/${document.slug}`}
              className="rounded-[9px] border border-line px-2.5 py-2 font-latin text-[13px] text-ink-light"
            >
              {locale === 'ar' ? 'EN' : 'ع'}
            </Link>
            <Link
              href={`/${locale}`}
              className="rounded-control px-3.5 py-2 text-[13.5px] font-medium text-ink-muted hover:text-ink"
            >
              {tr('legal.backHome')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 lg:px-8 lg:py-16">
        <h1 className="text-h1">{document.title}</h1>
        <p className="mt-3 text-[13px] text-ink-light">{tr('legal.updated')} {updated}</p>

        <article className="mt-10">
          <LegalBody body={document.body} />
        </article>

        {siblings.length > 1 && (
          <nav className="mt-14 flex flex-wrap gap-2.5 border-t border-line-soft pt-8">
            {siblings.map((link) => {
              const current = link.slug === document.slug;
              return (
                <Link
                  key={link.slug}
                  href={`/${locale}/legal/${link.slug}`}
                  aria-current={current ? 'page' : undefined}
                  className={`rounded-control border px-4 py-2.5 text-[13.5px] font-medium ${
                    current
                      ? 'border-emerald-700 bg-emerald-100 text-status-confirmedFg'
                      : 'border-line-strong text-ink-muted hover:text-ink'
                  }`}
                >
                  {link.title}
                </Link>
              );
            })}
          </nav>
        )}
      </main>
    </div>
  );
}
