'use client';

/**
 * Shared UI vocabulary.
 *
 * Extracted from the patterns the dashboard, checkout and invite screens had
 * already settled into, so the pages added later read as the same product
 * rather than as a second designer's work. Every token here comes from §00 of
 * the design doc via tailwind.config.ts — nothing invents a colour.
 */

import { useEffect, useRef } from 'react';
import type { GuestStatus } from '@da3wa/shared';

/* ── Buttons ──────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-700 text-[#F7F5EF] hover:bg-emerald-800 disabled:opacity-60',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-ink-light disabled:opacity-60',
  ghost: 'text-ink-muted hover:bg-surface-sand disabled:opacity-60',
  danger:
    'border border-[#E4CBC9] bg-surface text-status-declinedFg hover:bg-status-declinedBg disabled:opacity-60',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-[13px]',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-700/20 disabled:cursor-not-allowed ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    />
  );
}

/** Same shape as Button, for navigation rather than action. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <a
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-700/20 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    />
  );
}

/* ── Form fields ──────────────────────────────────────────────────────────── */

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10 disabled:bg-surface-muted disabled:text-ink-light';

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13.5px] font-medium text-[#3D4741]">
        {label}
        {required && <span className="ms-1 text-status-declined">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-[12.5px] text-status-declinedFg">{error}</span>
      ) : hint ? (
        <span className="text-[12.5px] text-ink-light">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${className}`} />;
}

export function Textarea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} min-h-[96px] leading-relaxed ${className}`} />;
}

export function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} appearance-none pe-9 ${className}`}>
      {children}
    </select>
  );
}

/**
 * Phone entry with a fixed +966 affix.
 *
 * Stays `dir="ltr"` inside the RTL page — digits are written left-to-right even
 * in Arabic, which is the rule the login screen already follows.
 */
export function PhoneInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      className={`flex items-center overflow-hidden rounded-control border border-line-strong bg-surface focus-within:border-emerald-700 focus-within:ring-4 focus-within:ring-emerald-700/10 ${className}`}
    >
      <span className="border-e border-line bg-[#F7F6F2] px-3.5 py-3 font-latin text-[15px] font-medium text-ink-muted">
        +966
      </span>
      <input
        dir="ltr"
        inputMode="tel"
        placeholder="5X XXX XXXX"
        {...props}
        className="flex-1 bg-transparent px-3.5 py-3 font-latin text-[15px] tracking-wide outline-none"
      />
    </div>
  );
}

/* ── Status ───────────────────────────────────────────────────────────────── */

const STATUS_CHIP: Record<GuestStatus, string> = {
  NOT_SENT: 'bg-status-notSentBg text-status-notSentFg',
  SENT: 'bg-status-pendingBg text-status-pendingFg',
  OPENED: 'bg-status-pendingBg text-status-pendingFg',
  CONFIRMED: 'bg-status-confirmedBg text-status-confirmedFg',
  DECLINED: 'bg-status-declinedBg text-status-declinedFg',
  ATTENDED: 'bg-emerald-700 text-surface-sand',
};

const STATUS_DOT: Record<GuestStatus, string> = {
  NOT_SENT: 'bg-status-notSent',
  SENT: 'bg-status-pending',
  OPENED: 'bg-status-pending',
  CONFIRMED: 'bg-status-confirmed',
  DECLINED: 'bg-status-declined',
  ATTENDED: 'bg-gold',
};

export function StatusChip({ status, label }: { status: GuestStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-chip px-3 py-1.5 text-caption font-medium ${STATUS_CHIP[status]}`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${STATUS_DOT[status]}`} />
      {label}
    </span>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export function Card({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-card border border-line-soft bg-surface shadow-sh-1 ${className}`}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-h2">{title}</h1>
        {subtitle && <p className="text-[13.5px] text-ink-light">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/**
 * An empty screen is an invitation to act, so this always carries its action
 * rather than only explaining the absence.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-surface-sand text-[22px] text-emerald-700">
        ✦
      </div>
      <h2 className="text-h3">{title}</h2>
      <p className="max-w-sm text-body text-ink-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Errors state what happened and how to fix it — they do not apologise. */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  retryLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-status-declinedBg text-[22px] text-status-declinedFg">
        !
      </div>
      <h2 className="text-h3">{title}</h2>
      <p className="max-w-sm text-body text-ink-muted">{body}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-8 py-16 text-body text-ink-muted">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-emerald-700 motion-reduce:animate-none"
      />
      {label}
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────── */

/**
 * Bottom sheet on phones, centred dialog on wider screens — the shape the
 * dashboard's send panel already uses. Escape closes; focus moves in on open so
 * keyboard users are not left behind the overlay.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`flex max-h-[88vh] w-full flex-col rounded-t-card bg-surface outline-none sm:rounded-card ${
          wide ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex flex-col gap-1.5 border-b border-line-soft p-6">
          <h2 className="text-h3">{title}</h2>
          {description && (
            <p className="text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2.5 border-t border-line-soft p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Toast ────────────────────────────────────────────────────────────────── */

export interface ToastMessage {
  text: string;
  tone: 'success' | 'error';
}

/**
 * Confirmation of an action that has already happened, so it announces politely
 * rather than interrupting.
 */
export function Toast({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[92vw] px-4"
    >
      <div
        className={`rounded-control px-5 py-3.5 text-sm font-medium shadow-sh-3 ${
          message.tone === 'success'
            ? 'bg-emerald-700 text-[#F7F5EF]'
            : 'bg-status-declinedFg text-[#FDF6F5]'
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

/* ── Table ────────────────────────────────────────────────────────────────── */

/**
 * Wide tables scroll inside their own container so the page body never scrolls
 * sideways on a phone.
 */
export function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-start">{children}</table>
    </div>
  );
}

export function Th({
  className = '',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={`whitespace-nowrap border-b border-line px-4 py-3 text-start text-[12.5px] font-medium text-ink-light ${className}`}
    />
  );
}

export function Td({
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={`border-b border-[#F2F0EA] px-4 py-3.5 text-[14px] align-middle ${className}`}
    />
  );
}

export function Checkbox({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      {...props}
      className={`h-[17px] w-[17px] cursor-pointer accent-emerald-700 ${className}`}
    />
  );
}
