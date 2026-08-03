'use client';

/**
 * The operator frame.
 *
 * Deliberately the same shape as the host's AppShell — green sidebar, brand
 * lockup, greeting and logout in the header — because it is the same product
 * wearing a different hat. The admin panel used to be a bare page with a
 * horizontal chip strip and a stray link back to the dashboard, which read as a
 * different, lesser application.
 *
 * What it does *not* copy is the current-event card and the guest-facing nav:
 * an admin has no events, and none of those screens exist for them.
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Logo } from './Logo';
import { translator, type AppLocale } from '@/lib/i18n';

/** «صباح الخير» before noon, as everywhere else in the product. */
function greetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'dash.greetingMorning';
  if (hour < 17) return 'dash.greetingAfternoon';
  return 'dash.greetingEvening';
}

export function AdminShell<T extends string>({
  locale,
  sections,
  active,
  onSelect,
  children,
}: {
  locale: AppLocale;
  /** Nav entries, in order. `label` is already translated. */
  sections: Array<{ key: T; label: string }>;
  active: T;
  onSelect: (key: T) => void;
  children: React.ReactNode;
}) {
  const t = translator(locale);
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  // Choosing a section on a phone should close the drawer, not leave it over
  // the table the operator just asked for.
  useEffect(() => setNavOpen(false), [active]);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-emerald-900 p-5 text-[#DCE7E1]">
      <Logo
        locale={locale}
        href={`/${locale}/admin`}
        nameClassName="text-lg font-semibold text-[#FFFDF7]"
      />

      <div className="rounded-card bg-emerald-800/70 px-4 py-3">
        <span className="text-[11.5px] tracking-wide text-[#8FA69B]">{t('admin.title')}</span>
        <p className="text-[14px] font-medium leading-snug text-[#FFFDF7]">{user?.name}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {sections.map((section) => (
          <button
            key={section.key}
            onClick={() => onSelect(section.key)}
            aria-current={active === section.key ? 'page' : undefined}
            className={`rounded-[11px] px-3.5 py-3 text-start text-[14.5px] transition-colors ${
              active === section.key
                ? 'bg-emerald-700 font-medium text-[#FFFDF7]'
                : 'text-[#8FA69B] hover:bg-emerald-800 hover:text-[#DCE7E1]'
            }`}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F4EE] lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onMouseDown={() => setNavOpen(false)}
        >
          <div className="h-full w-[264px] max-w-[82vw]" onMouseDown={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNavOpen(true)}
              aria-label={t('nav.openMenu')}
              className="rounded-[9px] border border-line-strong px-3 py-2 text-sm lg:hidden"
            >
              ☰
            </button>
            <span className="text-[15.5px] font-semibold">
              {t(greetingKey(), { name: user?.name ?? '' })}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={`/${locale === 'ar' ? 'en' : 'ar'}${pathname.slice(`/${locale}`.length)}`}
              className="rounded-[9px] border border-line px-2.5 py-2 font-latin text-[13px] text-ink-light"
            >
              {locale === 'ar' ? 'EN' : 'ع'}
            </a>
            <button
              onClick={() => void logout().then(() => router.replace(`/${locale}/login`))}
              className="rounded-[11px] border border-line-strong bg-surface px-4 py-2 text-sm font-medium"
            >
              {t('auth.logout')}
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
