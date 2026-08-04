import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PublicInvitation } from '@da3wa/shared';
import { fetchTemplates } from '@/lib/api.server';
import { apiUrl } from '@/lib/api';
import { DEFAULT_LOCALE, isLocale, t, type AppLocale } from '@/lib/i18n';
import { InviteScreen } from '@/app/invite/[token]/InviteScreen';

/**
 * The sample invitation behind «شاهد نموذج دعوة» (§01).
 *
 * The landing page's second button used to be an anchor to the how-it-works
 * section, so a visitor asking to *see* an invitation was shown three
 * paragraphs about invitations. This is the real thing: the same `InviteScreen`
 * a guest opens, wired to a fixture instead of a database row.
 *
 * The same component on purpose. A hand-built mock is a promise nobody keeps —
 * it stops matching the invite page the first time either changes, and the one
 * screen a prospect judges the product by is then the one screen that lies.
 *
 * Nothing here writes. There is no guest, no event and no invitation record, so
 * answering moves local state only (see `InviteScreen`'s `demo` prop) and the
 * seeded demo event is never touched.
 */
export const dynamic = 'force-dynamic';

/** Far enough out that the sample never reads as an event already past. */
const DAYS_AHEAD = 21;

export function generateMetadata({ params }: PageProps): Metadata {
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return { title: t(locale, 'demo.title') };
}

interface PageProps {
  params: { locale: string };
  searchParams: { lang?: string };
}

/**
 * Build the fixture.
 *
 * Dates are relative to now rather than hard-coded, so the sample cannot rot
 * into an invitation to a wedding that happened last year.
 */
function sampleInvitation(locale: AppLocale, artworkUrl: string | null): PublicInvitation {
  const tr = (key: string) => t(locale, key);

  const startsAt = new Date(Date.now() + DAYS_AHEAD * 86_400_000);
  // 20:30 Riyadh, the hour a Gulf wedding actually starts.
  startsAt.setUTCHours(17, 30, 0, 0);

  return {
    guest: {
      name: tr('demo.guestName'),
      // Two, so the companion picker — the part of the screen hosts most want
      // to see working — is on show rather than hidden.
      companionsAllowed: 2,
      companionsConfirmed: 0,
      status: 'SENT',
    },
    event: {
      title: tr('demo.eventTitle'),
      type: 'WEDDING',
      hostName: tr('demo.hostName'),
      partnerName: tr('demo.partnerName'),
      startsAt: startsAt.toISOString(),
      endsAt: null,
      timezone: 'Asia/Riyadh',
      venueName: tr('demo.venueName'),
      venueAddress: tr('demo.venueAddress'),
      venueLat: 24.7136,
      venueLng: 46.6753,
      venueMapUrl: null,
      // White, so the band behind the artwork reads as a frame rather than a
      // dark slab beside it. `cardTitleInk` turns the occasion's title to ink
      // for this choice — white on white would be an invisible title.
      cardColor: '#FFFFFF',
      cardTitleFont: 'amiri',
      cardDesignMode: 'TEMPLATE',
      customCardUrl: null,
      templateKey: null,
      cardArtworkUrl: artworkUrl,
      rsvpDeadline: null,
      sectionMode: 'SINGLE',
    },
    invitation: { displayCode: '4821-77', respondedAt: null },
    canRespond: { allowed: true },
  };
}

export default async function DemoPage({ params, searchParams }: PageProps) {
  if (!isLocale(params.locale)) notFound();
  // The invite header's language toggle links to `?lang=`, so honour it here
  // rather than leaving a control that does nothing on this route.
  const locale: AppLocale =
    searchParams.lang && isLocale(searchParams.lang) ? searchParams.lang : params.locale;

  // A real template from the catalogue, so the sample shows the operator's own
  // artwork. Falls back to the plain coloured card when none is uploaded yet.
  const templates = await fetchTemplates();
  const artwork = templates.find((template) => template.previewImageUrl)?.previewImageUrl ?? null;

  return (
    <InviteScreen
      invitation={sampleInvitation(locale, apiUrl(artwork))}
      locale={locale}
      token="demo"
      demo
    />
  );
}
