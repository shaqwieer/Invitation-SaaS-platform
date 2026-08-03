'use client';

/**
 * The delegate's distribution list.
 *
 * The problem, in the host's own words: أم العريس cannot invite أم العروس's
 * guests, because she does not have their numbers — but أم العروس does. So the
 * host mints a block of invitations, sends one message, and this is what opens
 * at the other end: her block, her guests, sent from her own phone.
 *
 * Two ways to send, because a delegate holds her guests as *contacts*, not as
 * digits she can type fifty times:
 *
 *   مشاركة  — the native share sheet, then she picks the contact in WhatsApp.
 *             One tap, no number typed. The realistic path on a phone.
 *   واتساب   — for a number she does know, or has pasted.
 *
 * Both mark the invitation sent, on the same rule the host's own send follows:
 * we never touch the message, so the tap is the only signal there is.
 *
 * Note what this page never does: open an invitation. `GET /api/invite/:token`
 * marks a guest OPENED, so a delegate checking her links would report fifty
 * guests as having read invitations nobody had received yet.
 */

import { useCallback, useMemo, useState } from 'react';
import type { BatchSlotView, PublicBatch } from '@da3wa/shared';
import { browserApiBase } from '@/lib/api';
import { direction, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber, formatEventDate } from '@/lib/format';

export function BatchScreen({
  batch,
  locale,
  token,
}: {
  batch: PublicBatch;
  locale: AppLocale;
  token: string;
}) {
  const t = translator(locale);
  const dir = direction(locale);
  const n = (value: number) => displayNumber(value, locale);

  const [slots, setSlots] = useState(batch.slots);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const date = formatEventDate(batch.event.startsAt, batch.event.timezone, locale);
  const hosts = [batch.event.hostName, batch.event.partnerName]
    .filter(Boolean)
    .join(locale === 'ar' ? ' و' : ' & ');

  const sent = useMemo(() => slots.filter((slot) => slot.sentAt !== null).length, [slots]);
  const next = slots.find((slot) => slot.sentAt === null) ?? null;

  const replace = (slot: BatchSlotView) =>
    setSlots((prev) => prev.map((row) => (row.guestId === slot.guestId ? slot : row)));

  /** Persist a name or a number. Errors surface — a silent failure loses a guest. */
  const save = useCallback(
    async (guestId: string, patch: { name?: string | null; phone?: string | null }) => {
      setBusyId(guestId);
      setError(null);

      try {
        const res = await fetch(
          `${browserApiBase()}/api/batch/${token}/slots/${guestId}?lang=${locale}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );

        const body = await res.json().catch(() => null);

        if (!res.ok) {
          setError(
            body?.error?.details?.messageAr ??
              body?.error?.details?.fieldErrors?.phone?.[0] ??
              t('batch.saveFailed'),
          );
          return false;
        }

        replace(body.slot);
        return true;
      } catch {
        setError(t('batch.saveFailed'));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [token, locale, t],
  );

  const markSent = useCallback(
    async (guestId: string) => {
      try {
        const res = await fetch(
          `${browserApiBase()}/api/batch/${token}/slots/${guestId}/sent?lang=${locale}`,
          { method: 'POST' },
        );
        const body = await res.json().catch(() => null);

        if (!res.ok) {
          setError(body?.error?.details?.messageAr ?? t('batch.saveFailed'));
          return;
        }
        replace(body.slot);
      } catch {
        setError(t('batch.saveFailed'));
      }
    },
    [token, locale, t],
  );

  /**
   * Hand the invitation over.
   *
   * The share sheet where the browser has one — that is the whole point on a
   * phone — and the clipboard where it does not, so a desktop still works.
   */
  const share = useCallback(
    async (slot: BatchSlotView) => {
      setError(null);

      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ text: slot.message });
        } else {
          await navigator.clipboard.writeText(slot.message);
          setCopiedId(slot.guestId);
          setTimeout(() => setCopiedId(null), 2500);
        }
      } catch (err) {
        // Dismissing the share sheet throws AbortError. That is a decision not
        // to send, so it must not be reported as a failure or counted as sent.
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('batch.shareFailed'));
        return;
      }

      await markSent(slot.guestId);
    },
    [markSent, t],
  );

  return (
    /* Column-width on a desktop, full-bleed on a phone. She will most likely
       open this on the phone she is sending from, but the host checking the
       link on a laptop should not meet a row of stretched buttons. */
    <main dir={dir} lang={locale} className="flex min-h-screen flex-col bg-[#FAF8F3]">
      <header className="flex flex-col gap-1 border-b border-[#E2DFD6] bg-line-soft px-5 py-3.5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1">
          <span className="text-[15px] font-semibold">{batch.label}</span>
          <span className="text-[12.5px] text-ink-muted">
            {t('batch.subtitle', { hosts, title: batch.event.title })}
          </span>
          <span className="text-[12px] text-ink-faint">
            {date.weekday} {date.gregorian} · {date.time}
            {batch.event.venueName ? ` · ${batch.event.venueName}` : ''}
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-5 py-4">
        <div className="flex flex-col gap-2 rounded-[18px] border border-line-soft bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-medium">
              {t('batch.progress', { done: n(sent), total: n(slots.length) })}
            </span>
            {next && (
              <span className="text-[12.5px] text-ink-light">
                {t('batch.remaining', { count: n(slots.length - sent) })}
              </span>
            )}
          </div>

          <div
            className="h-1.5 overflow-hidden rounded-[3px] bg-line-soft"
            role="progressbar"
            aria-valuenow={sent}
            aria-valuemin={0}
            aria-valuemax={slots.length}
          >
            <div
              className="h-full bg-emerald-700 transition-[width]"
              style={{ width: `${(sent / Math.max(1, slots.length)) * 100}%` }}
            />
          </div>

          <p className="text-[12.5px] leading-relaxed text-ink-muted">{t('batch.howTo')}</p>
        </div>

        {error && (
          <p className="rounded-xl bg-status-declinedBg px-4 py-2.5 text-[13px] text-status-declinedFg">
            {error}
          </p>
        )}

        {slots.map((slot) => (
          <SlotRow
            key={slot.guestId}
            slot={slot}
            locale={locale}
            t={t}
            busy={busyId === slot.guestId}
            copied={copiedId === slot.guestId}
            onSave={(patch) => void save(slot.guestId, patch)}
            onShare={() => void share(slot)}
            onWhatsApp={() => void markSent(slot.guestId)}
          />
        ))}
      </div>

      <p className="mt-auto border-t border-line-soft px-5 py-4 text-center text-[12px] leading-relaxed text-ink-faint">
        {t('batch.footer')}
      </p>
    </main>
  );
}

type T = ReturnType<typeof translator>;

function SlotRow({
  slot,
  locale,
  t,
  busy,
  copied,
  onSave,
  onShare,
  onWhatsApp,
}: {
  slot: BatchSlotView;
  locale: AppLocale;
  t: T;
  busy: boolean;
  copied: boolean;
  onSave: (patch: { name?: string | null; phone?: string | null }) => void;
  onShare: () => void;
  onWhatsApp: () => void;
}) {
  const done = slot.sentAt !== null;
  const answered =
    slot.status === 'CONFIRMED' || slot.status === 'DECLINED' || slot.status === 'ATTENDED';

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-[18px] border p-3.5 ${
        done ? 'border-[#E3EDE8] bg-[#F7FBF9]' : 'border-line-soft bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12.5px] text-ink-light">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
              done ? 'bg-emerald-700 text-[#F7F5EF]' : 'border border-line-strong text-ink-faint'
            }`}
            aria-hidden
          >
            {done ? '✓' : ''}
          </span>
          {t('batch.slot', { number: displayNumber(slot.position, locale) })}
        </span>

        {answered && (
          <span className="rounded-chip bg-emerald-100 px-2.5 py-1 text-[11.5px] text-status-confirmedFg">
            {t(`status.${slot.status}`)}
          </span>
        )}
      </div>

      {/* Once the guest has answered, their own name is on the door list — the
          delegate tidying her sheet afterwards must not overwrite it. */}
      <input
        defaultValue={slot.name ?? ''}
        disabled={busy || answered}
        maxLength={120}
        placeholder={t('batch.namePlaceholder')}
        aria-label={t('batch.namePlaceholder')}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value !== (slot.name ?? '')) onSave({ name: value || null });
        }}
        className="rounded-[12px] border border-line-strong bg-surface px-3.5 py-2.5 text-[14.5px] outline-none focus:border-emerald-700 disabled:bg-surface-muted disabled:text-ink-light"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onShare}
          disabled={busy}
          className={`flex-1 rounded-[12px] px-4 py-2.5 text-[13.5px] font-semibold ${
            done
              ? 'border border-line-strong bg-surface text-ink-muted'
              : 'bg-emerald-700 text-[#F7F5EF]'
          }`}
        >
          {copied ? t('batch.copied') : done ? t('batch.shareAgain') : t('batch.share')}
        </button>

        {slot.whatsappUrl ? (
          <a
            href={slot.whatsappUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={onWhatsApp}
            className="rounded-[12px] border border-line-strong bg-surface px-4 py-2.5 text-[13.5px] font-medium"
          >
            {t('batch.whatsapp')}
          </a>
        ) : (
          <input
            dir="ltr"
            inputMode="tel"
            disabled={busy || answered}
            placeholder={t('batch.phonePlaceholder')}
            aria-label={t('batch.phonePlaceholder')}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value) onSave({ phone: value });
            }}
            className="w-[150px] rounded-[12px] border border-line-strong bg-surface px-3 py-2.5 font-latin text-[13.5px] outline-none focus:border-emerald-700 disabled:bg-surface-muted"
          />
        )}
      </div>
    </section>
  );
}
