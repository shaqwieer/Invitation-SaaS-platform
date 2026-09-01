'use client';

/**
 * The card-design choice, shared by the wizard and the card editor.
 *
 * These lived inside the card editor, which meant the creation wizard's design
 * step could only offer a colour and a font — a host finished the wizard, paid,
 * and only discovered the templates later by finding «بطاقة الدعوة» in the
 * sidebar. The controls are the same question in both places, so they are one
 * component asked twice rather than two screens that drift.
 *
 * Presentational on purpose: no fetching, no saving. The wizard holds an event
 * that does not exist yet and the editor holds one that does, and neither fact
 * belongs in here.
 */

import type { DesignRequestView } from '@da3wa/shared';
import { Card, Field, Select, Textarea } from '@/components/ui';
import { CARD_COLOURS, SWATCH_BORDER } from '@/lib/cardColour';
import { apiUrl } from '@/lib/api';
import type { AppLocale, translator } from '@/lib/i18n';

export type T = ReturnType<typeof translator>;

export interface Template {
  previewImageUrl: string | null;
  id: string;
  nameAr: string;
  nameEn: string;
  category: string;
}

export type DesignMode = 'TEMPLATE' | 'CUSTOM_REQUEST' | 'UPLOAD';

export const DESIGN_MODES: DesignMode[] = ['TEMPLATE', 'CUSTOM_REQUEST', 'UPLOAD'];

/**
 * «كيف تبغى بطاقتك؟» — the three routes.
 *
 * Returns the grid without a Card wrapper: the editor gives it a panel of its
 * own, the wizard already sits inside one, and baking the wrapper in would nest
 * a card inside a card on the wizard step.
 */
export function DesignModeChooser({
  mode,
  onChange,
  t,
}: {
  mode: DesignMode;
  onChange: (mode: DesignMode) => void;
  t: T;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {DESIGN_MODES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          className={`flex flex-col gap-1.5 rounded-card border p-4 text-start transition-colors ${
            mode === value
              ? 'border-emerald-700 bg-emerald-100/50'
              : 'border-line-soft bg-surface hover:border-line-strong'
          }`}
        >
          <span className="text-[14.5px] font-semibold">{t(`card.mode.${value}`)}</span>
          <span className="text-[12.5px] leading-relaxed text-ink-light">
            {t(`card.mode.${value}.hint`)}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The templates, as pictures.
 *
 * A dropdown of names was the wrong control for this: nobody picks a wedding
 * card by reading «كلاسيكي ذهبي» in a `<select>`. The design doc describes a
 * gallery, and the catalogue has carried `previewImageUrl` all along.
 *
 * `tailoring` is absent in the wizard — there is no event yet to have a job
 * queued against it.
 */
export function TemplateGallery({
  templates,
  templateId,
  onPick,
  details = '',
  onDetails,
  tailoring = null,
  bare = false,
  locale,
  t,
}: {
  templates: Template[];
  templateId: string;
  onPick: (id: string) => void;
  /** «البيانات المطلوبة في الكرت» — omitted when the caller cannot save it. */
  details?: string;
  onDetails?: (value: string) => void;
  tailoring?: DesignRequestView | null;
  /** Render without the Card shell, for a caller that already has one. */
  bare?: boolean;
  locale: AppLocale;
  t: T;
}) {
  const body = (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-medium text-[#3D4741]">{t('card.galleryTitle')}</span>
        <span className="text-[12.5px] leading-relaxed text-ink-light">
          {t('card.galleryHint')}
        </span>
      </div>

      {templates.length === 0 ? (
        <p className="rounded-control bg-surface-muted px-3.5 py-3 text-[12.5px] text-ink-muted">
          {t('card.galleryEmpty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {templates.map((template) => {
            const picked = template.id === templateId;
            // Resolved against the API origin: an uploaded preview arrives as a
            // path, and the web origin is a different port in development.
            const preview = apiUrl(template.previewImageUrl);

            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onPick(picked ? '' : template.id)}
                aria-pressed={picked}
                className={`flex flex-col overflow-hidden rounded-card border text-start transition-colors ${
                  picked ? 'border-emerald-700 ring-2 ring-emerald-700/20' : 'border-line-soft'
                }`}
              >
                <span className="flex aspect-[3/4] items-center justify-center bg-surface-muted">
                  {preview ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- operator artwork */
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[11.5px] text-ink-faint">{t('card.noPreview')}</span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
                  {locale === 'ar' ? template.nameAr : template.nameEn}
                  {picked && <span className="text-emerald-700">✓</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/*
        What the operator is supposed to write on it.

        Sits with the gallery rather than on a screen of its own because picking
        a template and saying what it should say are one decision: the design is
        adapted by hand afterwards, and a pick with no wording leaves the
        operator guessing at the names, the date's phrasing and the verse. Free
        text on purpose — every family words an invitation differently, and a
        fixed set of boxes would be a form to fight rather than fill.
      */}
      {onDetails && (
        <Field label={t('card.detailsLabel')} hint={t('card.detailsHint')}>
          <Textarea
            value={details}
            onChange={(e) => onDetails(e.target.value)}
            placeholder={t('card.detailsPlaceholder')}
            maxLength={2000}
            rows={5}
          />
        </Field>
      )}

      {/* What happens after the pick — the part a host cannot see for themselves. */}
      {tailoring && tailoring.status !== 'CANCELLED' && (
        <p className="rounded-control bg-surface-muted px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-muted">
          {t(`design.tailoring.${tailoring.status}`)}
        </p>
      )}
    </>
  );

  if (bare) return <div className="flex flex-col gap-4">{body}</div>;
  return <Card className="flex flex-col gap-4 p-6">{body}</Card>;
}

/** Colour swatches plus the free picker. Applies whichever route was chosen. */
export function CardColourField({
  colour,
  onChange,
  hint,
  t,
}: {
  colour: string;
  onChange: (value: string) => void;
  hint?: string;
  t: T;
}) {
  return (
    <Field label={t('event.cardColor')} hint={hint}>
      <div className="flex flex-wrap items-center gap-2.5">
        {CARD_COLOURS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-label={value}
            aria-pressed={colour === value}
            style={{ backgroundColor: value }}
            className={`h-9 w-9 rounded-full ${SWATCH_BORDER} transition-transform ${
              colour === value
                ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
                : 'hover:scale-105'
            }`}
          />
        ))}
        {/* A raw input, not <Input>: that component's base class is `w-full`,
            which beats a passed `w-14` and stretched the picker into something
            that read as an empty text field. */}
        <input
          type="color"
          value={colour}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded-control border border-line-strong bg-surface p-1"
          aria-label={t('event.cardColorCustom')}
        />
      </div>
    </Field>
  );
}

export function CardFontField({
  font,
  onChange,
  t,
}: {
  font: string;
  onChange: (value: string) => void;
  t: T;
}) {
  return (
    <Field label={t('event.cardFont')}>
      <Select value={font} onChange={(e) => onChange(e.target.value)}>
        <option value="amiri">{t('event.fontAmiri')}</option>
        <option value="plex-arabic">{t('event.fontPlex')}</option>
      </Select>
    </Field>
  );
}
