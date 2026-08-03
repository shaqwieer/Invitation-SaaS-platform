'use client';

/**
 * Guest list import (§06 of the design doc).
 *
 * The design's decision, kept verbatim: an import never fails wholesale because
 * of one bad row. Good rows always land, problem rows come back listed with what
 * is wrong, and Gulf phone numbers arriving as ٠٥…, +٩٦٦… or ٩٦٦… are normalised
 * automatically with the count of what was changed shown rather than hidden.
 *
 * Steps 2–4 are stateless on the server: the parsed rows live in this component
 * and travel back with each call, so an abandoned import leaves no guest phone
 * numbers staged anywhere.
 */

import { useCallback, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  ColumnMapping,
  ColumnMappingInput,
  ImportReport,
  ImportRowInput,
  InvalidImportRow,
  ParsedSheet,
  ValidImportRow,
} from '@da3wa/shared';
import type { Quota } from '@/components/EventContext';
import { useAuth } from '@/lib/auth';
import {
  Button,
  Card,
  PageHeader,
  Select,
  Spinner,
  TableFrame,
  Td,
  Th,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';

interface Preview extends ParsedSheet {
  /**
   * `{ columns, confidence }` — not the flat mapping the validate/commit calls
   * take. The confidence half is what drives the «تطابق تلقائي» and
   * «راجع الاختيار» badges the design asks for.
   */
  detectedMapping: ColumnMapping;
  sampleRows: ImportRowInput[];
}

/**
 * What validate and commit both return.
 *
 * Mirrors the API's `ImportOutcome`, which is declared beside the import service
 * rather than in the shared package — so it is restated here from the shared
 * pieces it is built out of.
 */
interface Outcome {
  report: ImportReport;
  errors: InvalidImportRow[];
  accepted: ValidImportRow[];
  quota: Quota;
}

const FIELDS = ['name', 'phone', 'companions', 'group', 'section'] as const;
type FieldKey = (typeof FIELDS)[number];

/** A → B → C, matching how the host reads their own spreadsheet. */
function columnLetter(index: number): string {
  let letter = '';
  let value = index;
  do {
    letter = String.fromCharCode(65 + (value % 26)) + letter;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letter;
}

export default function ImportPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const n = (value: number) => displayNumber(value, locale);
  const router = useRouter();
  const { authFetch } = useAuth();
  const eventId = params.eventId;

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [dragging, setDragging] = useState(false);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ColumnMappingInput | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* ── Step 1: parse ─────────────────────────────────────────────────────── */

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const form = new FormData();
        form.append('file', file);

        const res = await authFetch(`/api/events/${eventId}/guests/import/parse`, {
          method: 'POST',
          body: form,
        });

        if (!res.ok) {
          setToast({ tone: 'error', text: t('import.parseFailed') });
          return;
        }

        const body: Preview = await res.json();
        setPreview(body);
        setMapping(body.detectedMapping.columns);
        setStep(2);
      } catch {
        setToast({ tone: 'error', text: t('import.parseFailed') });
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, t],
  );

  /* ── Steps 3–4: validate then commit ───────────────────────────────────── */

  const run = useCallback(
    async (mode: 'validate' | 'commit') => {
      if (!preview || !mapping) return;
      setBusy(true);
      try {
        const res = await authFetch(`/api/events/${eventId}/guests/import/${mode}`, {
          method: 'POST',
          body: JSON.stringify({
            mapping,
            rows: preview.rows,
            options: { allowForeignNumbers: true, maxCompanions: 10 },
          }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setToast({
            tone: 'error',
            text: body?.error?.details?.messageAr ?? t('common.genericError'),
          });
          return;
        }

        setOutcome(body);

        if (mode === 'commit') {
          setToast({
            tone: 'success',
            text: t('import.imported', { count: n(body.report.imported) }),
          });
          router.push(`/${locale}/events/${eventId}/guests`);
          return;
        }

        setStep(3);
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, locale, mapping, n, preview, router, t],
  );

  const steps = [t('import.step1'), t('import.step2'), t('import.step3'), t('import.step4')];

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader title={t('import.title')} subtitle={t('import.stepOf', { step: n(step) })} />

      <ol className="flex flex-wrap gap-2">
        {steps.map((label, index) => {
          const number = index + 1;
          const state = number === step ? 'current' : number < step ? 'done' : 'upcoming';
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

      {/* ── Step 1 ──────────────────────────────────────────────────────── */}
      {step === 1 && (
        <Card className="flex flex-col gap-4 p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragging ? 'border-emerald-700 bg-emerald-100/50' : 'border-line-strong'
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sand text-[20px] text-emerald-700">
              ↑
            </span>
            <span className="text-[15px] font-medium">{t('import.dropTitle')}</span>
            <span className="text-[12.5px] text-ink-light">{t('import.dropHint')}</span>

            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              className="mt-2"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {t('import.choose')}
            </Button>
          </div>

          <div className="rounded-control bg-surface-muted px-4 py-3">
            <span className="text-[12.5px] font-medium">{t('import.required')}</span>
            <p className="text-[12.5px] text-ink-muted">{t('import.requiredList')}</p>
          </div>

          {busy && <Spinner label={t('common.loading')} />}
        </Card>
      )}

      {/* ── Step 2: column mapping ──────────────────────────────────────── */}
      {step === 2 && preview && mapping && (
        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-h3">{t('import.mapTitle')}</h2>
            <p className="text-body text-ink-muted">{t('import.mapBody')}</p>
            <p className="text-[12.5px] text-ink-light">
              {t('import.readRows', { count: n(preview.totalRows) })}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {FIELDS.map((field) => (
              <div
                key={field}
                className="flex flex-wrap items-center gap-3 rounded-control border border-line-soft p-3.5"
              >
                <span className="min-w-[120px] text-[14px] font-medium">
                  {t(`import.field.${field}`)}
                  {(field === 'name' || field === 'phone') && (
                    <span className="ms-1 text-status-declined">*</span>
                  )}
                </span>

                <Select
                  value={mapping[field] ?? ''}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      [field]: e.target.value === '' ? null : Number(e.target.value),
                    } as ColumnMappingInput)
                  }
                  className="w-auto flex-1 py-2 text-[13.5px]"
                  aria-label={t(`import.field.${field}`)}
                >
                  <option value="">{t('import.ignore')}</option>
                  {preview.headers.map((header, index) => (
                    <option key={index} value={index}>
                      {t('import.column', { letter: columnLetter(index) })} · {header}
                    </option>
                  ))}
                </Select>

                {mapping[field] !== null && preview.sampleRows[0] && (
                  <span className="text-[12.5px] text-ink-light">
                    «{String(preview.sampleRows[0].cells[mapping[field] as number] ?? '')}»
                  </span>
                )}

                {/* A fuzzy match is flagged rather than silently trusted — the
                    design's «راجع الاختيار». An exact one says so and is left
                    alone. */}
                {preview.detectedMapping.confidence[field] === 'auto' ? (
                  <span className="rounded-chip bg-status-confirmedBg px-2.5 py-1 text-[11.5px] text-status-confirmedFg">
                    {t('import.matchAuto')}
                  </span>
                ) : preview.detectedMapping.confidence[field] === 'review' ? (
                  <span className="rounded-chip bg-status-pendingBg px-2.5 py-1 text-[11.5px] text-status-pendingFg">
                    {t('import.matchReview')}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-between gap-2.5">
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(null);
                setStep(1);
              }}
            >
              {t('import.back')}
            </Button>
            <Button
              disabled={busy || mapping.name === null || mapping.phone === null}
              onClick={() => void run('validate')}
            >
              {t('common.next')}
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 3: review ──────────────────────────────────────────────── */}
      {step === 3 && outcome && (
        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-h3">
              {outcome.errors.length === 0
                ? t('import.reviewOk')
                : t('import.reviewTitle', { count: n(outcome.errors.length) })}
            </h2>
            <p className="text-body text-ink-muted">
              {t('import.readyBody', { count: n(outcome.accepted.length) })}
            </p>
            {outcome.report.reformattedPhones > 0 && (
              <p className="text-[12.5px] text-ink-light">
                {t('import.reformatted', { count: n(outcome.report.reformattedPhones) })}
              </p>
            )}
          </div>

          {outcome.errors.length > 0 && (
            <TableFrame>
              <thead>
                <tr>
                  <Th className="w-16">{t('import.row')}</Th>
                  <Th>{t('guests.name')}</Th>
                  <Th>{t('guests.phone')}</Th>
                  <Th>{t('import.problem')}</Th>
                </tr>
              </thead>
              <tbody>
                {outcome.errors.slice(0, 50).map((row, index) => (
                  <tr key={`${row.rowNumber}-${index}`}>
                    <Td className="ltr-nums text-ink-light">{n(row.rowNumber)}</Td>
                    <Td>{row.raw.name || t('common.none')}</Td>
                    <Td>
                      <span dir="ltr" className="font-latin text-[13px]">
                        {row.raw.phone || t('common.none')}
                      </span>
                    </Td>
                    <Td className="text-status-declinedFg">
                      {/* The server localises each issue, so the row explains
                          itself in the host's language rather than by code. */}
                      {row.issues
                        .map((issue) => (locale === 'ar' ? issue.messageAr : issue.messageEn))
                        .join(' · ')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}

          {outcome.quota.cap !== null && outcome.quota.exceeded && (
            <p className="rounded-control bg-status-pendingBg px-4 py-3 text-[13px] text-status-pendingFg">
              {t('import.overQuota')}
            </p>
          )}

          <div className="flex flex-wrap justify-between gap-2.5">
            <Button variant="secondary" onClick={() => setStep(2)}>
              {t('common.back')}
            </Button>
            <Button
              disabled={busy || outcome.accepted.length === 0}
              onClick={() => void run('commit')}
            >
              {t('import.confirmTitle', { count: n(outcome.accepted.length) })}
            </Button>
          </div>
        </Card>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
