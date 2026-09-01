'use client';

/**
 * Invitation card editor (§04, step 2).
 *
 * Built around one question — «كيف تبغى بطاقتك؟» — with three answers:
 *
 *   قالب من الموقع   pick one of ours; we then tailor it to this event by hand
 *   تصميم خاص        we draw it from scratch to a brief, at a quoted price
 *   تصميمك أنت       the host brings their own file
 *
 * The screen this replaced offered all three at once — a template dropdown, an
 * upload button and a URL box — and settled the conflict with a precedence note
 * at the bottom. That is a rule, not a choice: a host who uploaded a file to see
 * how it looked had silently left the template behind, with nothing telling them
 * why. Here the answer is stored (`cardDesignMode`) and only the chosen route's
 * controls are on screen.
 *
 * The card fields live on the event record, so this saves through the same PATCH
 * the settings page uses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatMoney, type DesignRequestView } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { useEvents } from '@/components/EventContext';
import { CardPreview } from '@/components/CardPreview';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import {
  CardColourField,
  CardFontField,
  DesignModeChooser,
  TemplateGallery,
  type DesignMode,
  type T,
  type Template,
} from '@/components/CardDesign';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { apiUrl } from '@/lib/api';

export default function CardPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const { authFetch } = useAuth();
  const { current, reload } = useEvents();
  const eventId = params.eventId;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [mode, setMode] = useState<DesignMode>('TEMPLATE');
  const [colour, setColour] = useState('#0E5A45');
  const [font, setFont] = useState('amiri');
  const [templateId, setTemplateId] = useState<string>('');
  const [customUrl, setCustomUrl] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [hasCardImage, setHasCardImage] = useState(false);
  const [cardVersion, setCardVersion] = useState(0);
  const [customRequest, setCustomRequest] = useState<DesignRequestView | null>(null);
  const [tailoring, setTailoring] = useState<DesignRequestView | null>(null);
  const [brief, setBrief] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const uploaded = hasCardImage ? apiUrl(`/api/events/${eventId}/card?v=${cardVersion}`) : null;
  const chosenTemplate = templates.find((tpl) => tpl.id === templateId) ?? null;
  // A template preview is either an external URL the operator pasted or a path
  // to our own bytes; apiUrl() resolves the second against the API origin, which
  // is not the web origin in development.
  const chosenTemplateArtwork = apiUrl(chosenTemplate?.previewImageUrl);

  /**
   * Mirrors `resolveArtwork` on the server, per mode.
   *
   * Duplicated deliberately rather than fetched: the editor has to describe the
   * *unsaved* state, and the server can only answer for what is stored.
   */
  const previewArtwork =
    mode === 'UPLOAD'
      ? (uploaded ?? (customUrl.trim() || null))
      : mode === 'CUSTOM_REQUEST'
        ? uploaded
        : (uploaded ?? chosenTemplateArtwork);

  const loadRequests = useCallback(async () => {
    const res = await authFetch(`/api/events/${eventId}/design-request`);
    if (!res.ok) return;
    const body = await res.json();
    setCustomRequest(body.custom ?? null);
    setTailoring(body.tailoring ?? null);
  }, [authFetch, eventId]);

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

  const requestCustom = async () => {
    setBusy(true);
    const res = await authFetch(`/api/events/${eventId}/design-request`, {
      method: 'POST',
      body: JSON.stringify({ notes: brief.trim() || null }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return setToast({
        tone: 'error',
        text: body?.error?.details?.messageAr ?? t('common.genericError'),
      });
    }

    const { request } = await res.json();
    setCustomRequest(request);
    setBrief('');
    setToast({ tone: 'success', text: t('design.requested') });
    await reload();
  };

  const cancelCustom = async () => {
    if (!customRequest) return;
    setBusy(true);
    const res = await authFetch(
      `/api/events/${eventId}/design-request/${customRequest.id}/cancel`,
      { method: 'POST' },
    );
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return setToast({
        tone: 'error',
        text: body?.error?.details?.messageAr ?? t('common.genericError'),
      });
    }

    const { request } = await res.json();
    setCustomRequest(request);
    setToast({ tone: 'success', text: t('design.cancelled') });
  };

  useEffect(() => {
    void authFetch('/api/catalogue')
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((body) => setTemplates(body.templates ?? []))
      .catch(() => undefined);
  }, [authFetch]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (current?.id !== eventId) return;
    setMode(current.cardDesignMode);
    setColour(current.cardColor);
    setFont(current.cardTitleFont);
    setTemplateId(current.templateId ?? '');
    setCustomUrl(current.customCardUrl ?? '');
    setDetails(current.cardDetails ?? '');
    setHasCardImage(current.hasCardImage);
    setCardVersion(current.cardImageVersion);
  }, [current, eventId]);

  if (!current || current.id !== eventId) return <Spinner label={t('common.loading')} />;

  const save = async () => {
    setBusy(true);
    const res = await authFetch(`/api/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        cardDesignMode: mode,
        cardColor: colour,
        cardTitleFont: font,
        // Only the chosen route's fields are written. Leaving the others behind
        // would recreate the ambiguity this screen exists to remove.
        templateId: mode === 'TEMPLATE' ? templateId || null : null,
        customCardUrl: mode === 'UPLOAD' ? customUrl || null : null,
        // Kept whichever route is chosen: a host who typed what the card should
        // say and then went to «تصميم خاص» has not withdrawn the wording, and
        // clearing it here would lose it on a mode change they never connected
        // to it.
        cardDetails: details.trim() || null,
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
    await Promise.all([reload(), loadRequests()]);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('settings.card')} subtitle={t('card.chooseSubtitle')} />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_320px]">
        <div className="flex flex-col gap-5">
          {/* ── The choice ───────────────────────────────────────────────── */}
          <Card className="flex flex-col gap-4 p-6">
            <span className="text-[13.5px] font-medium text-[#3D4741]">{t('card.chooseTitle')}</span>

            <DesignModeChooser mode={mode} onChange={setMode} t={t} />
          </Card>

          {/* ── The chosen route's controls ──────────────────────────────── */}
          {mode === 'TEMPLATE' && (
            <TemplateGallery
              templates={templates}
              templateId={templateId}
              onPick={setTemplateId}
              details={details}
              onDetails={setDetails}
              tailoring={tailoring}
              locale={locale}
              t={t}
            />
          )}

          {mode === 'CUSTOM_REQUEST' && (
            <CustomDesignPanel
              request={customRequest}
              brief={brief}
              onBrief={setBrief}
              onRequest={() => void requestCustom()}
              onCancel={() => void cancelCustom()}
              busy={busy}
              locale={locale}
              t={t}
            />
          )}

          {mode === 'UPLOAD' && (
            <Card className="flex flex-col gap-3 p-6">
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
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('card.upload')}
                </Button>
                {hasCardImage && (
                  <Button variant="danger" disabled={busy} onClick={() => void removeArtwork()}>
                    {t('card.remove')}
                  </Button>
                )}
              </div>

              <Field label={t('card.urlLabel')} hint={t('card.uploadPriority')}>
                <Input dir="ltr" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
              </Field>
            </Card>
          )}

          {/* ── Colour and font, whichever route ─────────────────────────── */}
          <Card className="flex flex-col gap-5 p-6">
            <CardColourField
              colour={colour}
              onChange={setColour}
              hint={t('card.colourNote')}
              t={t}
            />

            <CardFontField font={font} onChange={setFont} t={t} />

            <div className="flex justify-end">
              <Button disabled={busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          </Card>
        </div>

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

/**
 * «تصميم خاص» — the brief, and then the state of the job.
 *
 * Deliberately shows the *whole* pipeline, including the quoted price and that
 * it will be added to the invoice. A price agreed on a phone call and never
 * shown again is the kind of surprise that turns up at checkout.
 */
function CustomDesignPanel({
  request,
  brief,
  onBrief,
  onRequest,
  onCancel,
  busy,
  locale,
  t,
}: {
  request: DesignRequestView | null;
  brief: string;
  onBrief: (value: string) => void;
  onRequest: () => void;
  onCancel: () => void;
  busy: boolean;
  locale: AppLocale;
  t: T;
}) {
  const open = request && (request.status === 'REQUESTED' || request.status === 'IN_PROGRESS');
  const digits = locale === 'ar' ? 'arabic' : 'western';

  if (!request || request.status === 'CANCELLED') {
    return (
      <Card className="flex flex-col gap-3.5 p-6">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-medium text-[#3D4741]">{t('design.briefTitle')}</span>
          <span className="text-[12.5px] leading-relaxed text-ink-light">
            {t('design.briefHint')}
          </span>
        </div>

        <Textarea
          value={brief}
          onChange={(e) => onBrief(e.target.value)}
          placeholder={t('design.briefPlaceholder')}
          maxLength={2000}
        />

        <div className="flex justify-end">
          <Button disabled={busy} onClick={onRequest}>
            {t('design.requestCta')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] font-medium text-[#3D4741]">{t('design.statusTitle')}</span>
        <span className="rounded-chip bg-surface-muted px-3 py-1.5 text-[12.5px] text-ink-muted">
          {t(`design.status.${request.status}`)}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-muted">
        {t(`design.statusBody.${request.status}`)}
      </p>

      {request.notes && (
        <div className="flex flex-col gap-1 rounded-control bg-surface-muted px-3.5 py-3">
          <span className="text-[12px] text-ink-light">{t('design.yourBrief')}</span>
          <span className="whitespace-pre-wrap text-[13px] leading-relaxed">{request.notes}</span>
        </div>
      )}

      {request.adminNotes && (
        <div className="flex flex-col gap-1 rounded-control bg-emerald-100/60 px-3.5 py-3">
          <span className="text-[12px] text-status-confirmedFg">{t('design.ourReply')}</span>
          <span className="whitespace-pre-wrap text-[13px] leading-relaxed">
            {request.adminNotes}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line-soft pt-4">
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] text-ink-light">{t('design.price')}</span>
          <span className="text-[17px] font-semibold">
            {request.priceHalalas === null
              ? t('design.pricePending')
              : `${formatMoney(request.priceHalalas, { digits })} ${t('checkout.currency')}`}
          </span>
          {request.priceHalalas !== null && (
            <span className="text-[12px] text-ink-faint">
              {request.billedAt ? t('design.priceBilled') : t('design.priceAtCheckout')}
            </span>
          )}
        </div>

        {open && (
          <Button variant="danger" disabled={busy} onClick={onCancel}>
            {t('design.cancelCta')}
          </Button>
        )}
      </div>
    </Card>
  );
}
