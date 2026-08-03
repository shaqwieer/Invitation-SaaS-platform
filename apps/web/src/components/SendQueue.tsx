'use client';

/**
 * Tapping through a batch of WhatsApp invitations without losing your place.
 *
 * The batch endpoint hands back one `wa.me` link per guest and the host opens
 * them one at a time — not because that is elegant, but because it is the only
 * honest way to send from *their own number*. Browsers block every
 * `window.open` after the first, so firing thirty would send one invitation and
 * silently drop twenty-nine.
 *
 * What was missing was the bookkeeping. A flat list of thirty identical buttons
 * gives no answer to the only question a host has at guest nineteen — «وين
 * وصلت؟» — and WhatsApp steals the tab on every tap, so they come back to a
 * list that looks exactly as it did before they started. This tracks which
 * links have been opened, counts them, and always offers the next one.
 *
 * "Opened", not "delivered": we never touch the message, so a tap on the link
 * is the last thing we can observe. The strings say فُتحت for that reason —
 * claiming delivery here would be inventing a fact.
 */

import { useState } from 'react';
import { displayNumber } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';

export interface SendQueueLink {
  guestId: string;
  guestName: string;
  whatsappUrl: string;
}

export function SendQueue({
  links,
  locale,
  t,
}: {
  links: SendQueueLink[];
  locale: AppLocale;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const n = (value: number) => displayNumber(value, locale);
  const done = links.reduce((count, link) => count + (opened.has(link.guestId) ? 1 : 0), 0);
  const next = links.find((link) => !opened.has(link.guestId)) ?? null;

  const markOpened = (guestId: string) =>
    setOpened((prev) => {
      const updated = new Set(prev);
      updated.add(guestId);
      return updated;
    });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px] font-medium">
            {t('send.progress', { done: n(done), total: n(links.length) })}
          </span>
          {done > 0 && done < links.length && (
            <span className="text-[12.5px] text-ink-light">
              {t('send.remaining', { count: n(links.length - done) })}
            </span>
          )}
        </div>

        <div
          className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={links.length}
        >
          <div
            className="h-full bg-emerald-700 transition-[width]"
            style={{ width: `${(done / Math.max(1, links.length)) * 100}%` }}
          />
        </div>
      </div>

      {/* The one control the host actually needs: whoever is next, one tap. */}
      {next ? (
        <a
          href={next.whatsappUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => markOpened(next.guestId)}
          className="flex items-center justify-center gap-2 rounded-control bg-emerald-700 px-4 py-3.5 text-center text-[14.5px] font-semibold text-[#F7F5EF]"
        >
          {t('send.next', { name: next.guestName })}
        </a>
      ) : (
        <p className="rounded-control bg-emerald-100 px-4 py-3.5 text-center text-[13.5px] font-medium text-status-confirmedFg">
          {t('send.allOpened', { count: n(links.length) })}
        </p>
      )}

      <div className="max-h-[42vh] overflow-y-auto">
        {links.map((link) => {
          const isOpened = opened.has(link.guestId);

          return (
            <div
              key={link.guestId}
              className="flex items-center justify-between gap-3 border-b border-[#F2F0EA] py-3 last:border-0"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    isOpened
                      ? 'bg-emerald-700 text-[#F7F5EF]'
                      : 'border border-line-strong text-ink-faint'
                  }`}
                  aria-hidden
                >
                  {isOpened ? '✓' : ''}
                </span>
                <span className={`text-[14.5px] ${isOpened ? 'text-ink-light' : ''}`}>
                  {link.guestName}
                </span>
              </span>

              <a
                href={link.whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => markOpened(link.guestId)}
                className={`shrink-0 rounded-[9px] px-4 py-2 text-[13px] font-semibold ${
                  isOpened
                    ? 'border border-line-strong bg-surface text-ink-muted'
                    : 'bg-emerald-700 text-[#F7F5EF]'
                }`}
              >
                {isOpened ? t('send.again') : t('dash.sendOne')}
              </a>
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-faint">{t('send.note')}</p>
    </div>
  );
}
