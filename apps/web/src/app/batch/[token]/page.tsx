import type { Metadata } from 'next';
import { fetchBatch } from '@/lib/api.server';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { InviteMissing } from '@/app/invite/[token]/InviteMissing';
import { BatchScreen } from './BatchScreen';

/**
 * A delegate's block of invitations.
 *
 * Outside the `/[locale]` segment and with no auth, exactly like
 * `/invite/[token]`: whoever opens this got the link in a WhatsApp message and
 * has no account, no locale prefix and no reason to acquire either.
 *
 * Never cached, never indexed. The page lists a block of named guests and their
 * numbers, and one delegate must never be served another's.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { token: string };
  searchParams: { lang?: string };
}

export function generateMetadata({ searchParams }: PageProps): Metadata {
  const locale = resolveLocale(searchParams.lang);
  return {
    title: locale === 'ar' ? 'دعوات للتوزيع' : 'Invitations to send',
    robots: { index: false, follow: false },
  };
}

function resolveLocale(lang: string | undefined): AppLocale {
  return lang && isLocale(lang) ? lang : DEFAULT_LOCALE;
}

export default async function BatchPage({ params, searchParams }: PageProps) {
  const locale = resolveLocale(searchParams.lang);
  const t = translator(locale);

  let batch: Awaited<ReturnType<typeof fetchBatch>>;
  try {
    batch = await fetchBatch(params.token);
  } catch {
    return (
      <InviteMissing locale={locale} title={t('invite.errorTitle')} body={t('batch.notFoundBody')} />
    );
  }

  if (!batch) {
    return (
      <InviteMissing
        locale={locale}
        title={t('batch.notFoundTitle')}
        body={t('batch.notFoundBody')}
      />
    );
  }

  return <BatchScreen batch={batch} locale={locale} token={params.token} />;
}
