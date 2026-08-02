import { notFound } from 'next/navigation';
import { AuthProvider } from '@/lib/auth';
import { LOCALES, direction, isLocale } from '@/lib/i18n';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * Sets the document direction for this locale subtree.
 *
 * Next renders one <html> per request from the root layout, so the direction is
 * applied to a wrapper here rather than duplicating the html element. Everything
 * inside inherits it, which is what makes the RTL/LTR mirror in the design work
 * without per-component branching.
 */
export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!isLocale(params.locale)) notFound();

  return (
    <div dir={direction(params.locale)} lang={params.locale} className="min-h-screen">
      {/* Host session lives here. The invite and scanner routes sit outside this
          segment and deliberately have no host auth at all. */}
      <AuthProvider>{children}</AuthProvider>
    </div>
  );
}
