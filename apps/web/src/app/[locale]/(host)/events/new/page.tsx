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
import { formatMoney } from '@da3wa/shared';
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
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { EVENT_TYPES, toIso, toLocalInput } from '@/lib/eventForm';
import { CARD_COLOURS, SWATCH_BORDER } from '@/lib/cardColour';
import { displayNumber } from '@/lib/format';

interface Package {
  id: string;
  nameAr: string;
  nameEn: string;
  guestCap: number;
  priceHalalas: number;
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

  const [title, setTitle] = useState('');
  const [type, setType] = useState('WEDDING');
  const [sectionMode, setSectionMode] = useState('SINGLE');
  const [startsAt, setStartsAt] = useState(defaultStart());
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [hostName, setHostName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [cardColor, setCardColor] = useState('#0E5A45');
  const [cardTitleFont, setCardTitleFont] = useState('amiri');
  const [defaultCompanions, setDefaultCompanions] = useState(0);

  useEffect(() => {
    void authFetch('/api/catalogue')
      .then((res) => (res.ok ? res.json() : { packages: [] }))
      .then((body) => setPackages(body.packages ?? []))
      .catch(() => undefined);
  }, [authFetch]);

  const detailsReady = title.trim().length >= 2 && hostName.trim().length >= 2 && !!startsAt;

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
          cardColor,
          cardTitleFont,
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
        router.push(`/${locale}/events/${eventId}/guests`);
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
                <h2 className="text-h3">{t('event.designTitle')}</h2>
                <p className="text-body text-ink-muted">{t('event.designBody')}</p>
              </div>

              <Field label={t('event.cardColor')}>
                <div className="flex flex-wrap items-center gap-2.5">
                  {CARD_COLOURS.map((value) => (
                    <button
                      key={value}
                      onClick={() => setCardColor(value)}
                      aria-label={value}
                      aria-pressed={cardColor === value}
                      style={{ backgroundColor: value }}
                      className={`h-9 w-9 rounded-full ${SWATCH_BORDER} transition-transform ${
                        cardColor === value
                          ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
                          : 'hover:scale-105'
                      }`}
                    />
                  ))}
                  {/* See the card editor: <Input> is `w-full`, so the picker
                      has to be a raw input to stay swatch-sized. */}
                  <input
                    type="color"
                    value={cardColor}
                    onChange={(e) => setCardColor(e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded-control border border-line-strong bg-surface p-1"
                    aria-label={t('event.cardColorCustom')}
                  />
                </div>
              </Field>

              <Field label={t('event.cardFont')}>
                <Select
                  value={cardTitleFont}
                  onChange={(e) => setCardTitleFont(e.target.value)}
                >
                  <option value="amiri">{t('event.fontAmiri')}</option>
                  <option value="plex-arabic">{t('event.fontPlex')}</option>
                </Select>
              </Field>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  {t('common.back')}
                </Button>
                <Button onClick={() => setStep(3)}>{t('common.next')}</Button>
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
                    <span className="text-[26px] font-semibold leading-none">
                      {formatMoney(pkg.priceHalalas, {
                        digits: locale === 'ar' ? 'arabic' : 'western',
                      })}
                      <span className="ms-1.5 text-[13px] font-normal text-ink-light">
                        {t('checkout.currency')}
                      </span>
                    </span>
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
          locale={locale}
          t={t}
        />
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
