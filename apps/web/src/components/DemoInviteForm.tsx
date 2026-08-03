'use client';

/**
 * «أرسل لي دعوة تجريبية على واتساب» — the landing page's sample, delivered.
 *
 * A visitor who reads about a WhatsApp invitation and then reads *another web
 * page* about it has not seen the product. This puts the sample in their own
 * WhatsApp thread, on their own phone, arriving the way a guest's would.
 *
 * It sends nothing itself, exactly like the rest of the product: it opens a
 * `wa.me` deep link and the visitor taps send. That is the whole promise —
 * «الدعوات تُرسل من رقمك أنت» — and demonstrating it with a gateway that sends
 * from some platform number would demonstrate the wrong thing.
 */

import { useState } from 'react';
import { buildWhatsAppLink, normalizePhone } from '@da3wa/shared';
import type { AppLocale } from '@/lib/i18n';

export function DemoInviteForm({
  locale,
  labels,
}: {
  locale: AppLocale;
  /** Resolved by the server component so this stays out of the i18n bundle. */
  labels: {
    title: string;
    hint: string;
    placeholder: string;
    send: string;
    invalid: string;
    message: string;
  };
}) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const parsed = normalizePhone(phone);
    if (!parsed.ok) {
      setError(labels.invalid);
      return;
    }

    setError(null);

    // Absolute, because the link leaves the browser: a relative path pasted
    // into WhatsApp is not a link at all.
    const demoUrl = `${window.location.origin}/${locale}/demo`;
    const link = buildWhatsAppLink(parsed.e164, `${labels.message}\n${demoUrl}`);

    window.open(link, '_blank', 'noopener,noreferrer');
  };

  return (
    <form
      onSubmit={submit}
      className="flex max-w-md flex-col gap-2.5 rounded-card border border-line-soft bg-surface-muted p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-medium">{labels.title}</span>
        <span className="text-[12.5px] leading-relaxed text-ink-light">{labels.hint}</span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <input
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={labels.placeholder}
          aria-label={labels.title}
          aria-invalid={error ? true : undefined}
          className="min-w-[180px] flex-1 rounded-control border border-line-strong bg-surface px-3.5 py-3 font-latin text-[15px] tracking-wide outline-none focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
        />
        <button
          type="submit"
          className="rounded-control bg-emerald-700 px-5 py-3 text-[14px] font-semibold text-[#F7F5EF]"
        >
          {labels.send}
        </button>
      </div>

      {error && <span className="text-[12.5px] text-status-declinedFg">{error}</span>}
    </form>
  );
}
