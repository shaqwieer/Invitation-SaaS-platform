import type { Metadata } from 'next';
import { Amiri, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import '../styles/globals.css';
import { fetchBranding } from '@/lib/api.server';
import { BrandProvider } from '@/components/BrandContext';
import { apiUrl } from '@/lib/api';

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

/** Reserved for card titles and invocations — never for UI chrome. */
const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

/**
 * Title and description follow the operator's branding, so renaming the product
 * in the admin panel changes the browser tab too — not just the pixels.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await fetchBranding();
  return {
    title: `${branding.brandNameAr} · ${branding.brandNameEn}`,
    description: branding.taglineAr,
    // Absolute: the favicon URL is resolved by the browser against the web
    // origin, where /api does not exist outside the nginx deployment.
    icons: apiUrl(branding.logoUrl) ? { icon: apiUrl(branding.logoUrl)! } : undefined,
  };
}

/**
 * Root layout.
 *
 * lang/dir are set by the [locale] segment below, not here — the invite route
 * lives outside the locale prefix (a guest opens a bare /invite/<token> link)
 * and picks its own direction from the event.
 *
 * Branding is fetched once here and shared through context: it appears on every
 * screen including the account-less invite and scanner routes, so the provider
 * has to sit above all of them.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await fetchBranding();

  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${plexArabic.variable} ${plex.variable} ${amiri.variable} ${plexMono.variable}`}
    >
      <body className="bg-board">
        <BrandProvider branding={branding}>{children}</BrandProvider>
      </body>
    </html>
  );
}
