import type { Metadata } from 'next';
import { Amiri, IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google';
import '../styles/globals.css';

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

export const metadata: Metadata = {
  title: 'دعوة · Da3wa',
  description: 'منصة سعودية للدعوات الرقمية وإدارة حضور المناسبات.',
};

/**
 * Root layout.
 *
 * lang/dir are set by the [locale] segment below, not here — the invite route
 * lives outside the locale prefix (a guest opens a bare /invite/<token> link)
 * and picks its own direction from the event.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${plexArabic.variable} ${plex.variable} ${amiri.variable} ${plexMono.variable}`}
    >
      <body className="bg-board">{children}</body>
    </html>
  );
}
