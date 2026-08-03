import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatMoney, toArabicIndicDigits } from '@da3wa/shared';
import { fetchBranding, fetchPackages } from '@/lib/api.server';
import { DemoInviteForm } from '@/components/DemoInviteForm';
import { Logo } from '@/components/Logo';
import { isLocale, t, type AppLocale } from '@/lib/i18n';

/**
 * Landing page (§01 of the design doc).
 *
 * The design's decision, kept as the whole shape of the hero: the first thing a
 * visitor sees is the invitation arriving *inside a WhatsApp thread from the
 * host's own number*. "Who will the invitation come from?" is the first
 * objection a Gulf customer raises, and answering it in prose below the fold
 * would be answering it too late.
 *
 * A server component: the FAQ is native <details>, keyboard-accessible and
 * working before hydration, rather than a bundle shipped to open an accordion.
 * The only client code on the page is the Logo, which needs the operator's
 * branding from context.
 */
/*
 * No route-level revalidate: branding is read with `no-store` so an operator's
 * rebrand shows on the next reload, which makes this route dynamic regardless.
 * The price list keeps its own 5-minute cache inside `fetchPackages`, so the
 * expensive read is still amortised.
 */

export default async function LandingPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound();
  const locale: AppLocale = params.locale;
  const tr = (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  const digits = locale === 'ar' ? 'arabic' : 'western';
  const num = (value: number) => (locale === 'ar' ? toArabicIndicDigits(String(value)) : String(value));

  const [packages, branding] = await Promise.all([fetchPackages(), fetchBranding()]);
  const tagline = locale === 'ar' ? branding.taglineAr : branding.taglineEn;
  const other = locale === 'ar' ? 'en' : 'ar';

  const steps = [1, 2, 3].map((index) => ({
    index,
    title: tr(`land.step${index}t`),
    body: tr(`land.step${index}b`),
  }));

  const faqs = [1, 2, 3, 4, 5].map((index) => ({
    q: tr(`land.faq${index}q`),
    a: tr(`land.faq${index}a`),
  }));

  return (
    <div className="bg-surface">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-3.5 lg:px-8">
          <Logo locale={locale} href={`/${locale}`} />

          <nav className="hidden flex-1 items-center gap-6 ps-6 text-[13.5px] text-ink-muted md:flex">
            <a href="#how" className="hover:text-ink">
              {tr('nav.howItWorks')}
            </a>
            <a href="#pricing" className="hover:text-ink">
              {tr('nav.pricing')}
            </a>
            <a href="#faq" className="hover:text-ink">
              {tr('nav.faq')}
            </a>
          </nav>

          <div className="ms-auto flex items-center gap-2.5">
            <a
              href={`/${other}`}
              className="rounded-[9px] border border-line px-2.5 py-2 font-latin text-[13px] text-ink-light"
            >
              {locale === 'ar' ? 'EN' : 'ع'}
            </a>
            <Link
              href={`/${locale}/login`}
              className="rounded-control px-3.5 py-2 text-[13.5px] font-medium text-ink-muted hover:text-ink"
            >
              {tr('nav.login')}
            </Link>
            <Link
              href={`/${locale}/register`}
              className="rounded-control bg-emerald-700 px-4 py-2.5 text-[13.5px] font-semibold text-[#F7F5EF]"
            >
              {tr('nav.start')}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 lg:grid-cols-[1.1fr_400px] lg:px-8 lg:py-20">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-chip bg-emerald-100 px-3.5 py-2 text-[12.5px] font-medium text-status-confirmedFg">
            <span className="h-[6px] w-[6px] rounded-full bg-emerald-700" />
            {tr('land.eyebrow')}
          </span>

          <h1 className="text-h1 lg:text-display">{tr('land.h1')}</h1>

          <p className="max-w-xl text-body text-ink-muted">{tr('land.sub')}</p>

          <div className="flex flex-wrap gap-3">
            <Link
              href={`/${locale}/register`}
              className="rounded-control bg-emerald-700 px-6 py-4 text-base font-semibold text-[#F7F5EF]"
            >
              {tr('land.ctaPrimary')}
            </Link>
            {/* Points at the sample invitation itself. It used to be an anchor
                to #how, so a visitor asking to *see* an invitation was scrolled
                to three paragraphs describing one. */}
            <Link
              href={`/${locale}/demo`}
              className="rounded-control border border-line-strong bg-surface px-6 py-4 text-base font-semibold"
            >
              {tr('land.ctaSecondary')}
            </Link>
          </div>

          <DemoInviteForm
            locale={locale}
            labels={{
              title: tr('demo.formTitle'),
              hint: tr('demo.formHint'),
              placeholder: '05XXXXXXXX',
              send: tr('demo.formSend'),
              invalid: tr('demo.formInvalid'),
              message: tr('demo.waMessage'),
            }}
          />

          <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-4 border-t border-line-soft pt-6">
            {[1, 2, 3].map((index) => (
              <div key={index} className="flex flex-col gap-1">
                <dt className="text-[21px] font-semibold">{tr(`land.stat${index}v`)}</dt>
                <dd className="text-[12.5px] text-ink-light">{tr(`land.stat${index}l`)}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* The signature element: the invitation inside a WhatsApp thread. */}
        <div className="relative mx-auto w-full max-w-[360px]">
          <div className="absolute -inset-4 rounded-[36px] bg-emerald-100/60" aria-hidden />
          <div className="relative flex flex-col gap-3 rounded-[28px] border border-line bg-[#E9E3DB] p-4 shadow-sh-3">
            <div className="flex items-center gap-2.5 rounded-[14px] bg-surface px-3 py-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-[12px] text-surface-sand">
                أ
              </span>
              <span className="text-[13px] font-medium">{tr('land.waName')}</span>
            </div>

            <div className="ms-auto w-[92%] rounded-[16px] rounded-se-[4px] bg-[#DCF8C6] px-3.5 py-2.5">
              <p className="text-[12.5px] leading-relaxed text-[#1C3329]">{tr('land.waMsg')}</p>
              <p dir="ltr" className="mt-1 font-latin text-[12px] text-[#0E5A45] underline">
                da3wa.sa/i/f8k2n
              </p>
            </div>

            <div className="flex flex-col items-center gap-3 rounded-[18px] bg-emerald-900 px-5 py-6 text-center">
              <span className="text-[9.5px] text-white/50">{tr('invite.bismillah')}</span>
              <span className="text-[11px] text-white/70">
                {locale === 'ar'
                  ? 'يتشرّف عبدالعزيز بن سعد و لمى بنت خالد بدعوتكم'
                  : 'Abdulaziz and Lama request your presence'}
              </span>
              <span className="font-serif text-[23px] text-[#FFFDF7]">
                {locale === 'ar' ? 'حفل الزفاف' : 'The Wedding'}
              </span>
              <span className="h-px w-10 bg-gold" />
              <span className="text-[11px] leading-relaxed text-white/75">
                {locale === 'ar'
                  ? 'الجمعة ٢٠ نوفمبر ٢٠٢٦ · ٨:٣٠ مساءً'
                  : 'Friday 20 November 2026 · 8:30 pm'}
                <br />
                {locale === 'ar' ? 'قاعة الماسة، الرياض' : 'Al-Masa Hall, Riyadh'}
              </span>

              <div className="mt-2 flex w-full gap-2">
                <span className="flex-1 rounded-[10px] bg-[#FFFDF7] py-2 text-[12px] font-semibold text-emerald-800">
                  {tr('invite.accept')}
                </span>
                <span className="flex-1 rounded-[10px] border border-white/25 py-2 text-[12px] text-white/70">
                  {tr('invite.decline')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="border-y border-line bg-surface-muted">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
          <span className="font-mono text-[11px] tracking-[0.16em] text-ink-light">
            {tr('land.howEyebrow')}
          </span>
          <h2 className="mt-3 text-h2">{tr('land.howTitle')}</h2>

          {/* Numbered because these genuinely are a sequence: you cannot send
              before you have guests, or add guests before an event exists. */}
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((step) => (
              <li
                key={step.index}
                className="flex flex-col gap-3 rounded-card border border-line-soft bg-surface p-6"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-[15px] font-semibold text-surface-sand">
                  {num(step.index)}
                </span>
                <h3 className="text-h3">{step.title}</h3>
                <p className="text-body text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
        <span className="font-mono text-[11px] tracking-[0.16em] text-ink-light">
          {tr('land.pricingEyebrow')}
        </span>
        <h2 className="mt-3 text-h2">{tr('land.pricingTitle')}</h2>
        <p className="mt-3 max-w-2xl text-body text-ink-muted">{tr('land.pricingSub')}</p>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className={`relative flex flex-col gap-4 rounded-card border bg-surface p-6 ${
                pkg.isHighlighted ? 'border-gold shadow-sh-2' : 'border-line-soft'
              }`}
            >
              {pkg.isHighlighted && (
                <span className="absolute -top-3 end-6 rounded-chip bg-gold px-3 py-1 text-[11.5px] font-medium text-[#FFFDF7]">
                  {tr('land.popular')}
                </span>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">
                  {locale === 'ar' ? pkg.nameAr : pkg.nameEn}
                </span>
                <span className="text-[13px] text-ink-light">
                  {tr('land.guestsUpTo', { count: num(pkg.guestCap) })}
                </span>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-[30px] font-semibold leading-none">
                  {formatMoney(pkg.priceHalalas, { digits })}
                </span>
                <span className="text-[13px] text-ink-light">
                  {tr('checkout.currency')} {tr('land.perEvent')}
                </span>
              </div>

              <ul className="flex flex-1 flex-col gap-2 border-t border-line-soft pt-4">
                {(locale === 'ar' ? pkg.featuresAr : pkg.featuresEn).map((feature) => (
                  <li key={feature} className="flex gap-2 text-[13px] text-ink-muted">
                    <span className="text-emerald-700">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={`/${locale}/register`}
                className={`rounded-control py-3 text-center text-sm font-semibold ${
                  pkg.isHighlighted
                    ? 'bg-emerald-700 text-[#F7F5EF]'
                    : 'border border-line-strong bg-surface text-ink'
                }`}
              >
                {tr('land.choose')}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-line bg-surface-muted">
        <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8">
          <span className="font-mono text-[11px] tracking-[0.16em] text-ink-light">
            {tr('land.faqEyebrow')}
          </span>
          <h2 className="mt-3 text-h2">{tr('land.faqTitle')}</h2>

          <div className="mt-8 flex flex-col gap-3">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-card border border-line-soft bg-surface px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {faq.q}
                  <span className="shrink-0 text-[18px] text-ink-light group-open:hidden">+</span>
                  <span className="hidden shrink-0 text-[18px] text-ink-light group-open:inline">
                    −
                  </span>
                </summary>
                <p className="mt-3 text-body text-ink-muted">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-10 px-5 py-12 lg:px-8">
          <div className="flex max-w-xs flex-col gap-3">
            <Logo locale={locale} />
            <p className="text-[13px] leading-relaxed text-ink-muted">{tagline}</p>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-[12.5px] font-medium text-ink-light">
              {tr('land.footerProduct')}
            </span>
            <a href="#pricing" className="text-[13.5px] text-ink-muted hover:text-ink">
              {tr('nav.pricing')}
            </a>
            <a href="#how" className="text-[13.5px] text-ink-muted hover:text-ink">
              {tr('nav.howItWorks')}
            </a>
            <a href="#faq" className="text-[13.5px] text-ink-muted hover:text-ink">
              {tr('nav.faq')}
            </a>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-[12.5px] font-medium text-ink-light">
              {tr('land.footerCompany')}
            </span>
            <Link
              href={`/${locale}/login`}
              className="text-[13.5px] text-ink-muted hover:text-ink"
            >
              {tr('nav.login')}
            </Link>
            <Link
              href={`/${locale}/register`}
              className="text-[13.5px] text-ink-muted hover:text-ink"
            >
              {tr('nav.start')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
