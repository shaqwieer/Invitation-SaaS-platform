import { notFound } from 'next/navigation';
import { GUEST_STATUSES } from '@da3wa/shared';
import { isLocale, t } from '@/lib/i18n';

/**
 * Phase 1 placeholder.
 *
 * Deliberately not a stand-in for the landing page — it renders the status
 * palette and the type scale so the token wiring is verifiable now, and gets
 * replaced wholesale when §01 is built.
 */
const STATUS_CLASS: Record<string, string> = {
  NOT_SENT: 'bg-status-notSentBg text-status-notSentFg',
  SENT: 'bg-surface-sand text-ink-muted',
  OPENED: 'bg-surface-sand text-ink-muted',
  CONFIRMED: 'bg-status-confirmedBg text-status-confirmedFg',
  DECLINED: 'bg-status-declinedBg text-status-declinedFg',
  ATTENDED: 'bg-emerald-700 text-surface-sand',
};

const STATUS_DOT: Record<string, string> = {
  NOT_SENT: 'bg-status-notSent',
  SENT: 'bg-ink-light',
  OPENED: 'bg-ink-light',
  CONFIRMED: 'bg-status-confirmed',
  DECLINED: 'bg-status-declined',
  ATTENDED: 'bg-gold',
};

export default function LocaleHome({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound();
  const locale = params.locale;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-20">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-emerald-700 text-lg font-semibold text-surface-sand">
          د
        </span>
        <span className="text-h3">{t(locale, 'brand.name')}</span>
        <span className="font-mono text-xs tracking-[0.16em] text-ink-light">DA3WA</span>
      </header>

      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t(locale, 'scaffold.title')}</h1>
        <p className="max-w-xl text-body text-ink-muted">{t(locale, 'scaffold.subtitle')}</p>
      </div>

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-8 shadow-sh-1">
        <span className="font-mono text-[11px] tracking-[0.12em] text-ink-light">
          {t(locale, 'scaffold.tokens')}
        </span>
        <div className="flex flex-wrap gap-2.5">
          {GUEST_STATUSES.map((status) => (
            <span
              key={status}
              className={`inline-flex items-center gap-2 rounded-chip px-3.5 py-2 text-caption font-medium ${STATUS_CLASS[status]}`}
            >
              <span className={`h-[7px] w-[7px] rounded-full ${STATUS_DOT[status]}`} />
              {t(locale, `status.${status}`)}
            </span>
          ))}
        </div>
      </section>

      <footer className="flex items-center gap-4 text-caption text-ink-light">
        <a className="text-emerald-700 hover:underline" href={locale === 'ar' ? '/en' : '/ar'}>
          {locale === 'ar' ? 'English' : 'العربية'}
        </a>
        <span className="ltr-nums">API · :4000/health</span>
      </footer>
    </main>
  );
}
