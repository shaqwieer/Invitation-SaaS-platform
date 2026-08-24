'use client';

/**
 * Event creation wizard (§04 of the design doc).
 *
 * The design's decision, kept: the card preview sits beside the form and reacts
 * to every field, so the host sees the invitation as their guests will see it
 * before they pay. Three steps rather than the design's four — guests come after
 * the event exists, so the wizard hands off to the guest list instead of trying
 * to collect people before there is anything to invite them to.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useEvents } from '@/components/EventContext';
import { CardPreview } from '@/components/CardPreview';
import { PackagePrice } from '@/components/PackagePrice';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import {
  CardColourField,
  CardFontField,
  DesignModeChooser,
  TemplateGallery,
  type DesignMode,
  type Template,
} from '@/components/CardDesign';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { EVENT_TYPES, normaliseUrl, toIso, toLocalInput } from '@/lib/eventForm';
import { apiUrl } from '@/lib/api';
import { displayNumber } from '@/lib/format';

interface Package {
  id: string;
  nameAr: string;
  nameEn: string;
  guestCap: number;
  priceHalalas: number;
  compareAtHalalas: number | null;
  scannerSeats: number;
  featuresAr: string[];
  featuresEn: string[];
  isHighlighted: boolean;
}

/** Default to a sensible future evening rather than an empty required field. */
function defaultStart(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 2);
  date.setHours(20, 30, 0, 0);
  return date.toISOString();
}

export default function NewEventPage() {
  const params = useParams<{ locale: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const n = (value: number) => displayNumber(value, locale);
  const router = useRouter();
  const { authFetch } = useAuth();
  const { reload } = useEvents();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [title, setTitle] = useState('');
  const [type, setType] = useState('WEDDING');
  const [sectionMode, setSectionMode] = useState('SINGLE');
  const [startsAt, setStartsAt] = useState(defaultStart());
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [hostName, setHostName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  /*
   * The map link, collected here rather than only in event settings.
   *
   * Its absence from this step was the whole bug behind «لما اضغط على رابط
   * الخرائط مايظهر لي الموقع»: an event created in the wizard had no way to
   * carry one, so the invitation's maps button fell back to *searching* for the
   * venue name — and «القصر» matches a dozen halls in Jeddah alone. The host had
   * pasted a link; there was simply nowhere for it to go.
   */
  const [venueMapUrl, setVenueMapUrl] = useState('');
  const [cardColor, setCardColor] = useState('#0E5A45');
  const [cardTitleFont, setCardTitleFont] = useState('amiri');
  const [cardDesignMode, setCardDesignMode] = useState<DesignMode>('TEMPLATE');
  const [templateId, setTemplateId] = useState('');
  const [defaultCompanions, setDefaultCompanions] = useState(0);

  // One call feeds both steps — /api/catalogue has always returned the
  // templates alongside the packages; the wizard simply threw them away.
  useEffect(() => {
    void authFetch('/api/catalogue')
      .then((res) => (res.ok ? res.json() : { packages: [], templates: [] }))
      .then((body) => {
        setPackages(body.packages ?? []);
        setTemplates(body.templates ?? []);
      })
      .catch(() => undefined);
  }, [authFetch]);

  // The preview answers «كيف ستبدو؟» for a template pick too, not just colour
  // and font. Nothing can be uploaded yet, so the catalogue artwork is the only
  // possible source here — the editor's fuller resolution comes later.
  const previewArtwork =
    cardDesignMode === 'TEMPLATE'
      ? apiUrl(templates.find((tpl) => tpl.id === templateId)?.previewImageUrl)
      : null;

  const detailsReady = title.trim().length >= 2 && hostName.trim().length >= 2 && !!startsAt;

  /**
   * «قالب من الموقع» is the default, so leaving the step untouched would create
   * an event on the template route with no template — valid to the schema,
   * invisible to the operator, and a design nobody is working on. The other two
   * routes carry their own follow-up screen, so they need no pick here.
   *
   * An empty gallery is not the host's fault: with nothing to choose they may
   * pass, and `create` sends them to the card editor rather than the guest list.
   */
  const designReady = cardDesignMode !== 'TEMPLATE' || !!templateId || templates.length === 0;

  /**
   * Create the event, then optionally the order.
   *
   * The event is created first and on its own: if the package step fails or the
   * host abandons checkout, they still have an event to come back to rather
   * than having lost everything they typed.
   */
  const create = async (packageId: string | null) => {
    setBusy(true);
    try {
      const res = await authFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          title,
          type,
          sectionMode,
          startsAt,
          endsAt,
          hostName,
          partnerName: partnerName || null,
          venueName: venueName || null,
          venueAddress: venueAddress || null,
          venueMapUrl: normaliseUrl(venueMapUrl),
          cardColor,
          cardTitleFont,
          cardDesignMode,
          // '' is not a valid id — the schema's `.min(1)` would reject it, so an
          // unmade choice has to travel as null.
          templateId: cardDesignMode === 'TEMPLATE' ? templateId || null : null,
          defaultCompanionsAllowed: defaultCompanions,
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setToast({
          tone: 'error',
          text: body?.error?.details?.messageAr ?? t('event.createFailed'),
        });
        return;
      }

      const eventId: string = body.event.id;
      await reload();

      if (!packageId) {
        // «تصميم خاص» and «تصميمك أنت» both need something the wizard cannot
        // collect — a brief, or a file — because neither can be attached to an
        // event that does not exist yet. Hand off to the card editor rather
        // than leaving the event claiming a design route nobody followed up.
        router.push(
          cardDesignMode === 'TEMPLATE' && templateId
            ? `/${locale}/events/${eventId}/guests`
            : `/${locale}/events/${eventId}/card`,
        );
        return;
      }

      const order = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ eventId, packageId }),
      });

      if (!order.ok) {
        // The event exists; only the order failed. Send them to the guest list
        // rather than stranding them on a dead wizard step.
        setToast({ tone: 'error', text: t('common.genericError') });
        router.push(`/${locale}/events/${eventId}/guests`);
        return;
      }

      const orderBody = await order.json();
      router.push(`/${locale}/checkout/${orderBody.order.id}`);
    } finally {
      setBusy(false);
    }
  };

  const steps = [t('event.step1'), t('event.step2'), t('event.step3')];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('event.wizardTitle')} />

      <ol className="flex flex-wrap gap-2">
        {steps.map((label, index) => {
          const number = index + 1;
          const state =
            number === step ? 'current' : number < step ? 'done' : 'upcoming';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-chip px-3.5 py-2 text-[13px] ${
                state === 'current'
                  ? 'bg-emerald-700 font-medium text-[#F7F5EF]'
                  : state === 'done'
                    ? 'bg-emerald-100 text-status-confirmedFg'
                    : 'bg-surface text-ink-light'
              }`}
            >
              <span className="ltr-nums">{n(number)}</span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_320px]">
        <Card className="flex flex-col gap-5 p-6">
          {step === 1 && (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-h3">{t('event.detailsTitle')}</h2>
                <p className="text-body text-ink-muted">{t('event.detailsBody')}</p>
              </div>

              <Field label={t('event.title')} required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('event.type')}>
                  <Select value={type} onChange={(e) => setType(e.target.value)}>
                    {EVENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {t(`event.type.${value}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('event.sectionMode')}>
                  <Select
                    value={sectionMode}
                    onChange={(e) => setSectionMode(e.target.value)}
                  >
                    <option value="SINGLE">{t('event.sectionSingle')}</option>
                    <option value="SPLIT">{t('event.sectionSplit')}</option>
                  </Select>
                </Field>

                <Field label={t('event.startsAt')} required>
                  <Input
                    type="datetime-local"
                    value={toLocalInput(startsAt)}
                    onChange={(e) => setStartsAt(toIso(e.target.value) ?? startsAt)}
                  />
                </Field>

                <Field label={t('event.endsAt')}>
                  <Input
                    type="datetime-local"
                    value={toLocalInput(endsAt)}
                    onChange={(e) => setEndsAt(toIso(e.target.value))}
                  />
                </Field>

                <Field label={t('event.hostName')} required>
                  <Input value={hostName} onChange={(e) => setHostName(e.target.value)} />
                </Field>

                <Field label={t('event.partnerName')}>
                  <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
                </Field>
              </div>

              <Field label={t('event.venueName')}>
                <Input value={venueName} onChange={(e) => setVenueName(e.target.value)} />
              </Field>

              <Field label={t('event.venueAddress')}>
                <Input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
              </Field>

              <Field label={t('event.venueMapUrl')} hint={t('event.venueMapUrlHint')}>
                <Input
                  dir="ltr"
                  inputMode="url"
                  placeholder="https://maps.app.goo.gl/…"
                  value={venueMapUrl}
                  onChange={(e) => setVenueMapUrl(e.target.value)}
                />
              </Field>

              <Field label={t('event.defaultCompanions')}>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={defaultCompanions}
                  onChange={(e) => setDefaultCompanions(Number(e.target.value))}
                />
              </Field>

              <div className="flex justify-end">
                <Button disabled={!detailsReady} onClick={() => setStep(2)}>
                  {t('common.next')}
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-h3">{t('card.chooseTitle')}</h2>
                <p className="text-body text-ink-muted">{t('card.chooseSubtitle')}</p>
              </div>

              <DesignModeChooser mode={cardDesignMode} onChange={setCardDesignMode} t={t} />

              {cardDesignMode === 'TEMPLATE' ? (
                <TemplateGallery
                  templates={templates}
                  templateId={templateId}
                  onPick={setTemplateId}
                  bare
                  locale={locale}
                  t={t}
                />
              ) : (
                <p className="rounded-control bg-surface-muted px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-muted">
                  {t(`event.designAfterCreate.${cardDesignMode}`)}
                </p>
              )}

              <div className="border-t border-line-soft pt-5">
                <CardColourField
                  colour={cardColor}
                  onChange={setCardColor}
                  hint={t('card.colourNote')}
                  t={t}
                />
              </div>

              <CardFontField font={cardTitleFont} onChange={setCardTitleFont} t={t} />

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  {t('common.back')}
                </Button>
                <Button disabled={!designReady} onClick={() => setStep(3)}>
                  {t('common.next')}
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-h3">{t('event.packageTitle')}</h2>
                <p className="text-body text-ink-muted">{t('event.packageBody')}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`flex flex-col gap-3 rounded-card border p-5 ${
                      pkg.isHighlighted ? 'border-gold bg-gold-light/40' : 'border-line-soft'
                    }`}
                  >
                    <span className="text-[15px] font-semibold">
                      {locale === 'ar' ? pkg.nameAr : pkg.nameEn}
                    </span>
                    <PackagePrice
                      priceHalalas={pkg.priceHalalas}
                      compareAtHalalas={pkg.compareAtHalalas}
                      locale={locale}
                      currencyLabel={t('checkout.currency')}
                      discountLabel={(percent) => t('land.discountOff', { percent })}
                    />
                    <span className="text-[13px] text-ink-muted">
                      {t('event.packageGuests', { count: n(pkg.guestCap) })}
                    </span>
                    <ul className="flex flex-col gap-1.5">
                      {(locale === 'ar' ? pkg.featuresAr : pkg.featuresEn).map((feature) => (
                        <li key={feature} className="flex gap-2 text-[12.5px] text-ink-muted">
                          <span className="text-emerald-700">✓</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-auto"
                      disabled={busy}
                      onClick={() => void create(pkg.id)}
                    >
                      {t('event.choosePackage')}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-between gap-2.5">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  {t('common.back')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void create(null)}>
                  {t('event.skipPackage')}
                </Button>
              </div>
            </>
          )}
        </Card>

        <CardPreview
          title={title}
          hostName={hostName}
          partnerName={partnerName}
          venueName={venueName}
          startsAt={startsAt}
          timezone="Asia/Riyadh"
          cardColor={cardColor}
          cardTitleFont={cardTitleFont}
          artworkUrl={previewArtwork}
          locale={locale}
          t={t}
        />
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
