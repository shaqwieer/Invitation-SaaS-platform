import { direction, type AppLocale } from '@/lib/i18n';

/** Shown for an unknown token, and for an API failure — the guest can act on neither. */
export function InviteMissing({
  locale,
  title,
  body,
}: {
  locale: AppLocale;
  title: string;
  body: string;
}) {
  return (
    <main
      dir={direction(locale)}
      lang={locale}
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#FAF8F3] px-8 text-center"
    >
      <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-surface-sand">
        <div className="h-12 w-9 rounded-md border-[1.5px] border-dashed border-[#B9C0BA]" />
      </div>
      <h1 className="text-h3">{title}</h1>
      <p className="max-w-xs text-body text-ink-muted">{body}</p>
    </main>
  );
}
