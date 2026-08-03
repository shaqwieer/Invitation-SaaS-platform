'use client';

/**
 * «دعوات موزَّعة» — invitations the host hands to someone else to send.
 *
 * The case it exists for: أم العريس cannot invite أم العروس's guests, because
 * she does not have their numbers. She mints a block of fifty, sends *one*
 * WhatsApp message carrying the batch link, and أم العروس distributes the
 * invitations from her own phone.
 *
 * Each slot is a real guest with a real invitation — its own link, its own QR,
 * its own row in the report. Only the sending is delegated, which is why the
 * counts here are the same counts the dashboard shows.
 */

import { useCallback, useEffect, useState } from 'react';
import { MAX_BATCH_SLOTS, type BatchView } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import {
  Button,
  Card,
  Field,
  Input,
  LinkButton,
  Modal,
  PhoneInput,
  type ToastMessage,
} from '@/components/ui';
import { displayNumber } from '@/lib/format';
import type { translator, AppLocale } from '@/lib/i18n';

export function GuestBatches({
  eventId,
  locale,
  t,
  onToast,
  onGuestsChanged,
}: {
  eventId: string;
  locale: AppLocale;
  t: ReturnType<typeof translator>;
  onToast: (message: ToastMessage) => void;
  /** Slots are guests, so creating or deleting a batch moves the guest table. */
  onGuestsChanged: () => Promise<void> | void;
}) {
  const { authFetch } = useAuth();
  const n = (value: number) => displayNumber(value, locale);

  const [batches, setBatches] = useState<BatchView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BatchView | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/events/${eventId}/batches`);
    if (!res.ok) return setBatches([]);
    const body = await res.json();
    setBatches(body.batches ?? []);
  }, [authFetch, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: {
    label: string;
    delegateName: string;
    delegatePhone: string;
    count: number;
  }) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/events/${eventId}/batches`, {
        method: 'POST',
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        onToast({
          tone: 'error',
          text:
            body?.error?.details?.messageAr ??
            body?.error?.details?.fieldErrors?.delegatePhone?.[0] ??
            t('common.genericError'),
        });
        return false;
      }

      onToast({ tone: 'success', text: t('batches.created') });
      setCreating(false);
      await Promise.all([load(), onGuestsChanged()]);
      return true;
    } finally {
      setBusy(false);
    }
  };

  /** Tapping the delegate's WhatsApp link is the send, exactly as for a guest. */
  const markSent = async (batch: BatchView) => {
    await authFetch(`/api/events/${eventId}/batches/${batch.id}/sent`, { method: 'POST' });
    await load();
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/events/${eventId}/batches/${confirmDelete.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        onToast({ tone: 'error', text: t('common.genericError') });
        return;
      }

      const body = await res.json();
      onToast({
        tone: 'success',
        text: t('batches.deleted', {
          removed: n(body.removedSlots ?? 0),
          kept: n(body.keptGuests ?? 0),
        }),
      });
      setConfirmDelete(null);
      await Promise.all([load(), onGuestsChanged()]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{t('batches.title')}</span>
          <span className="max-w-2xl text-[12.5px] leading-relaxed text-ink-light">
            {t('batches.body')}
          </span>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('batches.create')}
        </Button>
      </div>

      {batches !== null && batches.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {batches.map((batch) => (
            <div
              key={batch.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-soft bg-surface-muted px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">{batch.label}</span>
                <span className="text-[12.5px] text-ink-light">
                  {batch.delegateName} ·{' '}
                  <span dir="ltr" className="font-latin ltr-nums">
                    {batch.delegatePhone}
                  </span>
                </span>
                <span className="text-[12.5px] text-ink-muted">
                  {t('batches.counts', {
                    sent: n(batch.counts.sent),
                    total: n(batch.counts.total),
                    confirmed: n(batch.counts.confirmed),
                  })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(batch.url);
                    onToast({ tone: 'success', text: t('common.copied') });
                  }}
                >
                  {t('common.copy')}
                </Button>
                <LinkButton
                  size="sm"
                  variant={batch.sentAt ? 'secondary' : 'primary'}
                  href={batch.whatsappUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => void markSent(batch)}
                >
                  {batch.sentAt ? t('batches.resend') : t('batches.send')}
                </LinkButton>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(batch)}>
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateBatchModal
          t={t}
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={(input) => void create(input)}
        />
      )}

      {confirmDelete && (
        <Modal
          title={t('batches.deleteTitle', { label: confirmDelete.label })}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-muted">{t('batches.deleteBody')}</p>
        </Modal>
      )}
    </Card>
  );
}

function CreateBatchModal({
  t,
  busy,
  onClose,
  onCreate,
}: {
  t: ReturnType<typeof translator>;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: {
    label: string;
    delegateName: string;
    delegatePhone: string;
    count: number;
  }) => void;
}) {
  const [label, setLabel] = useState('');
  const [delegateName, setDelegateName] = useState('');
  const [delegatePhone, setDelegatePhone] = useState('');
  const [count, setCount] = useState(25);

  const ready = label.trim().length >= 2 && delegateName.trim().length >= 2 && delegatePhone.trim();

  return (
    <Modal
      title={t('batches.createTitle')}
      description={t('batches.createBody')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !ready}
            onClick={() =>
              onCreate({
                label: label.trim(),
                delegateName: delegateName.trim(),
                delegatePhone: delegatePhone.trim(),
                count,
              })
            }
          >
            {t('batches.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('batches.label')} hint={t('batches.labelHint')}>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('batches.labelPlaceholder')}
            maxLength={80}
          />
        </Field>

        <Field label={t('batches.delegateName')}>
          <Input
            value={delegateName}
            onChange={(e) => setDelegateName(e.target.value)}
            maxLength={120}
          />
        </Field>

        <Field label={t('batches.delegatePhone')} hint={t('batches.delegatePhoneHint')}>
          <PhoneInput value={delegatePhone} onChange={(e) => setDelegatePhone(e.target.value)} />
        </Field>

        <Field label={t('batches.count')} hint={t('batches.countHint')}>
          <Input
            type="number"
            min={1}
            max={MAX_BATCH_SLOTS}
            value={count}
            onChange={(e) =>
              setCount(Math.min(MAX_BATCH_SLOTS, Math.max(1, Number(e.target.value) || 1)))
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
