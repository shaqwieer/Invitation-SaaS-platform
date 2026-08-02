import type { Metadata } from 'next';
import { fetchInvitation } from '@/lib/api.server';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { InviteScreen } from './InviteScreen';
import { InviteMissing } from './InviteMissing';

/**
 * The guest's invitation.
 *
 * Server-rendered, and outside the /[locale] segment: a guest opens a bare
 * da3wa.sa/invite/<token> link straight from WhatsApp, with no locale prefix to
 * carry. Language comes from ?lang= and otherwise defaults to Arabic.
 *
 * Every render hits the API — never statically generated, never cached. The
 * page contains a named guest's answer, and one guest must never be served
 * another's page.
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
    title: locale === 'ar' ? 'دعوة خاصة' : 'Personal invitation',
    // The link gets forwarded inside family group chats; a preview naming the
    // guest would leak who was invited to everyone in the thread.
    robots: { index: false, follow: false },
  };
}

function resolveLocale(lang: string | undefined): AppLocale {
  return lang && isLocale(lang) ? lang : DEFAULT_LOCALE;
}

export default async function InvitePage({ params, searchParams }: PageProps) {
  const locale = resolveLocale(searchParams.lang);
  const t = translator(locale);

  let invitation: Awaited<ReturnType<typeof fetchInvitation>>;
  try {
    invitation = await fetchInvitation(params.token);
  } catch {
    return (
      <InviteMissing
        locale={locale}
        title={t('invite.errorTitle')}
        body={t('invite.notFoundBody')}
      />
    );
  }

  if (!invitation) {
    return (
      <InviteMissing
        locale={locale}
        title={t('invite.notFoundTitle')}
        body={t('invite.notFoundBody')}
      />
    );
  }

  return <InviteScreen invitation={invitation} locale={locale} token={params.token} />;
}
