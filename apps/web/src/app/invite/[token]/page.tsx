import type { Metadata } from 'next';
import { fetchBranding, fetchInvitation } from '@/lib/api.server';
import { apiUrl } from '@/lib/api';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { InviteScreen } from './InviteScreen';
import { InviteMissing } from './InviteMissing';

/**
 * The guest's invitation.
 *
 * Server-rendered, and outside the /[locale] segment: a guest opens a bare
 * yahlainvite.com/invite/<token> link straight from WhatsApp, with no locale
 * prefix to carry. Language comes from ?lang= and otherwise defaults to Arabic.
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

/**
 * What WhatsApp draws above the link.
 *
 * The host's ask — «الدعوة لما تترسل تظهر صورة كرت الدعوة وتحتها رابط الدعوة» —
 * is exactly a link preview: WhatsApp renders `og:image` on top and the message
 * carrying the URL underneath it. We never send the message ourselves (the
 * whole product sends from the host's own number through `wa.me`), so the
 * preview is the only way a picture can travel with the link.
 *
 * The image is addressed by token, `/api/invite/<token>/card`, because that is
 * all this page holds — and resolving it through the API rather than fetching
 * the invitation here keeps the sender's preview from stamping `openedAt` on a
 * guest who has not seen anything yet.
 *
 * The card's artwork is shown; the guest's name still is not. The link is
 * forwarded inside family group chats, and who was invited is the part that
 * would leak — the wedding's own card is what every one of them is about to
 * receive anyway.
 */
export function generateMetadata({ params, searchParams }: PageProps): Metadata {
  const locale = resolveLocale(searchParams.lang);
  const title = locale === 'ar' ? 'دعوة خاصة' : 'Personal invitation';
  const description =
    locale === 'ar' ? 'افتح دعوتك وأكِّد حضورك' : 'Open your invitation and confirm your seat';
  const image = apiUrl(`/api/invite/${encodeURIComponent(params.token)}/card`);

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      title,
      description,
      // Absent when the API origin is unknown; a preview with no picture is the
      // old behaviour, not a broken page.
      ...(image ? { images: [{ url: image, alt: title }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
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

  /*
   * The header used to print a hardcoded "da3wa.sa". Reading the operator's own
   * brand instead means a rename is a settings change rather than a deploy —
   * and it is the one screen every guest sees, so it was the one place the old
   * name survived longest.
   *
   * Fetched after the invitation, not alongside it: branding is decoration and
   *  already falls back to the shipped identity, while a failed
   * invitation fetch has its own error screen above. Racing them would only pay
   * off on a page that is already waiting for the slower call.
   */
  const branding = await fetchBranding();

  return (
    <InviteScreen
      invitation={invitation}
      locale={locale}
      token={params.token}
      brandName={locale === 'ar' ? branding.brandNameAr : branding.brandNameEn}
    />
  );
}
