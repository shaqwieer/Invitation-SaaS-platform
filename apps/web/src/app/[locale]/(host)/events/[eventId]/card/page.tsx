'use client';

/**
 * Invitation card editor (§04, step 2).
 *
 * The nav has always listed «بطاقة الدعوة»; this is what it points at. The card
 * fields live on the event record, so this is a focused view of four of them
 * rather than a separate object — which is why it saves through the same
 * PATCH the settings page uses.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useEvents } from '@/components/EventContext';
import { CardPreview } from '@/components/CardPreview';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { CARD_COLOURS } from '@/lib/eventForm';
import { apiUrl } from '@/lib/api';

interface Template {
  previewImageUrl: string | null;
  id: string;
  nameAr: string;
  nameEn: string;
  category: string;
}

export default function CardPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const { authFetch } = useAuth();
  const { current, reload } = useEvents();
  const eventId = params.eventId;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [colour, setColour] = useState('#0E5A45');
  const [font, setFont] = useState('amiri');
  const [templateId, setTemplateId] = useState<string>('');
  const [customUrl, setCustomUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [hasCardImage, setHasCardImage] = useState(false);
  const [cardVersion, setCardVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Mirrors the server's resolution order in `invite.service.ts`.
   *
   * Duplicated deliberately rather than fetched: the editor has to describe the
   * *unsaved* state, and the server can only answer for what is stored.
   */
  const artworkSource: 'upload' | 'url' | 'template' | 'none' = hasCardImage
    ? 'upload'
    : customUrl.trim()
      ? 'url'
      : templates.find((tpl) => tpl.id === templateId)?.previewImageUrl
        ? 'template'
        : 'none';

  const previewArtwork =
    (hasCardImage ? apiUrl(`/api/events/${eventId}/card?v=${cardVersion}`) : null) ??
    (customUrl.trim() || null) ??
    templates.find((tpl) => tpl.id === templateId)?.previewImageUrl ??
    null;

  const uploadArtwork = async (chosen: File) => {
    setBusy(true);
    const body = new FormData();
    body.append('file', chosen);

    const res = await authFetch(`/api/events/${eventId}/card`, { method: 'POST', body });
    setBusy(false);

    if (!res.ok) return setToast({ tone: 'error', text: t('card.uploadFailed') });
    const { event } = await res.json();
    setHasCardImage(event.hasCardImage);
    setCardVersion(event.cardImageVersion);
    setToast({ tone: 'success', text: t('card.uploaded') });
    await reload();
  };

  const removeArtwork = async () => {
    setBusy(true);
    const res = await authFetch(`/api/events/${eventId}/card`, { method: 'DELETE' });
    setBusy(false);

    if (!res.ok) return setToast({ tone: 'error', text: t('common.genericError') });
    const { event } = await res.json();
    setHasCardImage(event.hasCardImage);
    setCardVersion(event.cardImageVersion);
    setToast({ tone: 'success', text: t('card.removed') });
    await reload();
  };

  useEffect(() => {
    void authFetch('/api/catalogue')
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((body) => setTemplates(body.templates ?? []))
      .catch(() => undefined);
  }, [authFetch]);

  useEffect(() => {
    if (current?.id !== eventId) return;
    setColour(current.cardColor);
    setFont(current.cardTitleFont);
    setTemplateId(current.templateId ?? '');
    setCustomUrl(current.customCardUrl ?? '');
    setHasCardImage(current.hasCardImage);
    setCardVersion(current.cardImageVersion);
  }, [current, eventId]);

  if (!current || current.id !== eventId) return <Spinner label={t('common.loading')} />;

  const save = async () => {
    setBusy(true);
    const res = await authFetch(`/api/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        cardColor: colour,
        cardTitleFont: font,
        templateId: templateId || null,
        customCardUrl: customUrl || null,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setToast({
        tone: 'error',
        text: body?.error?.details?.messageAr ?? t('common.genericError'),
      });
      return;
    }
    setToast({ tone: 'success', text: t('common.saved') });
    await reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('settings.card')} subtitle={t('event.designBody')} />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_320px]">
        <Card className="flex flex-col gap-5 p-6">
          <Field label={t('event.cardColor')}>
            <div className="flex flex-wrap items-center gap-2.5">
              {CARD_COLOURS.map((value) => (
                <button
                  key={value}
                  onClick={() => setColour(value)}
                  aria-label={value}
                  aria-pressed={colour === value}
                  style={{ backgroundColor: value }}
                  className={`h-9 w-9 rounded-full transition-transform ${
                    colour === value
                      ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
                      : 'hover:scale-105'
                  }`}
                />
              ))}
              <Input
                type="color"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                className="h-9 w-14 cursor-pointer p-1"
                aria-label={t('event.cardColor')}
              />
            </div>
          </Field>

          <Field label={t('event.cardFont')}>
            <Select value={font} onChange={(e) => setFont(e.target.value)}>
              <option value="amiri">{t('event.fontAmiri')}</option>
              <option value="plex-arabic">{t('event.fontPlex')}</option>
            </Select>
          </Field>

          <Field label={t('settings.card')}>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t('event.noTemplate')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {locale === 'ar' ? template.nameAr : template.nameEn}
                </option>
              ))}
            </Select>
          </Field>

          {/* ── Artwork ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 border-t border-line-soft pt-5">
            <div className="flex flex-col gap-1">
              <span className="text-[13.5px] font-medium text-[#3D4741]">{t('card.artwork')}</span>
              <span className="text-[12.5px] text-ink-light">{t('card.artworkHint')}</span>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) void uploadArtwork(chosen);
              }}
            />

            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
                {t('card.upload')}
              </Button>
              {hasCardImage && (
                <Button variant="danger" disabled={busy} onClick={() => void removeArtwork()}>
                  {t('card.remove')}
                </Button>
              )}
            </div>

            <Field label={t('card.urlLabel')} hint={t('card.priority')}>
              <Input dir="ltr" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
            </Field>

            {/* Three sources can supply the artwork and only one wins, so the
                editor says which — otherwise a host uploads a file, leaves an old
                URL in the box, and cannot tell what their guests will see. */}
            <p className="rounded-control bg-surface-muted px-3.5 py-2.5 text-[12.5px] text-ink-muted">
              {t('card.sourceNote', { source: t(`card.source.${artworkSource}`) })}
            </p>
          </div>

          <div className="flex justify-end">
            <Button disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </Card>

        <CardPreview
          title={current.title}
          hostName={current.hostName}
          partnerName={current.partnerName}
          venueName={current.venueName}
          startsAt={current.startsAt}
          timezone={current.timezone}
          cardColor={colour}
          cardTitleFont={font}
          artworkUrl={previewArtwork}
          locale={locale}
          t={t}
        />
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
