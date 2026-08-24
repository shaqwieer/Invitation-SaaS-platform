'use client';

/**
 * Event settings — the edit half of the wizard, plus the two things that exist
 * nowhere else: the door password the scanner depends on, and deleting the
 * event.
 *
 * The door password is the only credential the scanner has, so it gets its own
 * card rather than being a field in a long form — and clearing it is offered
 * explicitly, because "no password" is a real state (a closed door) rather than
 * an empty input.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useEvents, type HostEvent } from '@/components/EventContext';
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { EVENT_TYPES, EVENT_STATUSES, normaliseUrl, toLocalInput, toIso } from '@/lib/eventForm';

export default function EventSettingsPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { authFetch } = useAuth();
  const { current, reload } = useEvents();
  const eventId = params.eventId;

  const [form, setForm] = useState<HostEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteEcho, setDeleteEcho] = useState('');

  useEffect(() => {
    if (current?.id === eventId) setForm(current);
  }, [current, eventId]);

  const set = <K extends keyof HostEvent>(key: K, value: HostEvent[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const patch = useCallback(
    async (payload: Record<string, unknown>, successText: string) => {
      setBusy(true);
      try {
        const res = await authFetch(`/api/events/${eventId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setToast({
            tone: 'error',
            text: body?.error?.details?.messageAr ?? t('common.genericError'),
          });
          return false;
        }

        setToast({ tone: 'success', text: successText });
        await reload();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, reload, t],
  );

  if (!form) return <Spinner label={t('common.loading')} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('settings.title')} subtitle={form.title} />

      {/*
        Two columns on wide screens: what you edit often on the left, what you
        touch once or never on the right. A single 768px column left two thirds
        of a desktop empty and pushed the door password — the thing the scanner
        depends on — below the fold.
      */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
      {/* ── Details ─────────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-h3">{t('settings.details')}</h2>

        <Field label={t('event.title')} required>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          <Field label={t('event.type')}>
            <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`event.type.${type}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('settings.status')}>
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {EVENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`settings.status.${status}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('event.startsAt')} required>
            <Input
              type="datetime-local"
              value={toLocalInput(form.startsAt)}
              onChange={(e) => set('startsAt', toIso(e.target.value) ?? form.startsAt)}
            />
          </Field>

          <Field label={t('event.endsAt')}>
            <Input
              type="datetime-local"
              value={toLocalInput(form.endsAt)}
              onChange={(e) => set('endsAt', toIso(e.target.value))}
            />
          </Field>

          <Field label={t('event.hostName')} required>
            <Input value={form.hostName} onChange={(e) => set('hostName', e.target.value)} />
          </Field>

          <Field label={t('event.partnerName')}>
            <Input
              value={form.partnerName ?? ''}
              onChange={(e) => set('partnerName', e.target.value || null)}
            />
          </Field>

          <Field label={t('event.sectionMode')}>
            <Select value={form.sectionMode} onChange={(e) => set('sectionMode', e.target.value)}>
              <option value="SINGLE">{t('event.sectionSingle')}</option>
              <option value="SPLIT">{t('event.sectionSplit')}</option>
            </Select>
          </Field>

          <Field label={t('event.defaultCompanions')}>
            <Input
              type="number"
              min={0}
              max={20}
              value={form.defaultCompanionsAllowed}
              onChange={(e) => set('defaultCompanionsAllowed', Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label={t('event.venueName')}>
          <Input
            value={form.venueName ?? ''}
            onChange={(e) => set('venueName', e.target.value || null)}
          />
        </Field>

        <Field label={t('event.venueAddress')}>
          <Input
            value={form.venueAddress ?? ''}
            onChange={(e) => set('venueAddress', e.target.value || null)}
          />
        </Field>

        <Field label={t('event.venueMapUrl')} hint={t('event.venueMapUrlHint')}>
          <Input
            dir="ltr"
            inputMode="url"
            placeholder="https://maps.app.goo.gl/…"
            value={form.venueMapUrl ?? ''}
            onChange={(e) => set('venueMapUrl', e.target.value || null)}
          />
        </Field>

        <Field label={t('event.rsvpDeadline')}>
          <Input
            type="datetime-local"
            value={toLocalInput(form.rsvpDeadline)}
            onChange={(e) => set('rsvpDeadline', toIso(e.target.value))}
          />
        </Field>

        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() =>
              void patch(
                {
                  title: form.title,
                  type: form.type,
                  status: form.status,
                  sectionMode: form.sectionMode,
                  startsAt: form.startsAt,
                  endsAt: form.endsAt,
                  hostName: form.hostName,
                  partnerName: form.partnerName,
                  venueName: form.venueName,
                  venueAddress: form.venueAddress,
                  venueMapUrl: normaliseUrl(form.venueMapUrl),
                  rsvpDeadline: form.rsvpDeadline,
                  defaultCompanionsAllowed: form.defaultCompanionsAllowed,
                },
                t('common.saved'),
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      {/* ── WhatsApp message ────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-h3">{t('settings.whatsapp')}</h2>

        <Field label="العربية" hint={t('settings.whatsappHint')}>
          <Textarea
            value={form.whatsappTemplateAr}
            onChange={(e) => set('whatsappTemplateAr', e.target.value)}
          />
        </Field>

        <Field label="English" hint={t('settings.whatsappHint')}>
          <Textarea
            dir="ltr"
            value={form.whatsappTemplateEn}
            onChange={(e) => set('whatsappTemplateEn', e.target.value)}
          />
        </Field>

        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() =>
              void patch(
                {
                  whatsappTemplateAr: form.whatsappTemplateAr,
                  whatsappTemplateEn: form.whatsappTemplateEn,
                },
                t('common.saved'),
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

        </div>

        {/* Right column: set once, then forgotten — and one irreversible action. */}
        <div className="flex min-w-0 flex-col gap-5">
      {/* ── Door password ───────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3">{t('settings.scanner')}</h2>
          <span
            className={`rounded-chip px-3 py-1.5 text-caption font-medium ${
              form.hasScannerPassword
                ? 'bg-status-confirmedBg text-status-confirmedFg'
                : 'bg-status-declinedBg text-status-declinedFg'
            }`}
          >
            {form.hasScannerPassword ? t('settings.scannerSet') : t('settings.scannerUnset')}
          </span>
        </div>

        <p className="text-body text-ink-muted">{t('settings.scannerBody')}</p>

        {/* Eight is the server's rule (`passwordField`), so the button must not
            enable before then — a shorter one would look accepted and come back
            as a validation error. */}
        <Field label={t('settings.scannerPassword')} hint={t('settings.scannerMin')}>
          <Input
            type="text"
            dir="ltr"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="door1234"
          />
        </Field>

        <div className="flex flex-wrap justify-between gap-2.5">
          {form.hasScannerPassword && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void patch({ scannerPassword: null }, t('settings.scannerSaved')).then(
                  () => setPassword(''),
                )
              }
            >
              {t('settings.scannerClear')}
            </Button>
          )}
          <Button
            className="ms-auto"
            disabled={busy || password.trim().length < 8}
            onClick={() =>
              void patch({ scannerPassword: password }, t('settings.scannerSaved')).then((ok) => {
                if (ok) setPassword('');
              })
            }
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      {/* ── Delete ──────────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-3 border-[#E4CBC9] p-6">
        <h2 className="text-h3 text-status-declinedFg">{t('settings.danger')}</h2>
        <p className="text-body text-ink-muted">{t('settings.dangerBody')}</p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t('settings.danger')}
          </Button>
        </div>
      </Card>
        </div>
      </div>

      {confirmDelete && (
        <Modal
          title={t('settings.deleteTitle', { title: form.title })}
          description={t('settings.dangerBody')}
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                // Typing the name is the friction: this destroys an entire
                // wedding's data and a single misclick should not reach it.
                disabled={busy || deleteEcho.trim() !== form.title.trim()}
                onClick={async () => {
                  setBusy(true);
                  const res = await authFetch(`/api/events/${eventId}`, { method: 'DELETE' });
                  setBusy(false);
                  if (!res.ok) {
                    setToast({ tone: 'error', text: t('common.genericError') });
                    return;
                  }
                  await reload();
                  router.replace(`/${locale}/dashboard`);
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <Field label={t('settings.deleteConfirmLabel')}>
            <Input value={deleteEcho} onChange={(e) => setDeleteEcho(e.target.value)} />
          </Field>
        </Modal>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
