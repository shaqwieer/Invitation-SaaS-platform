/**
 * Domain enums, mirrored 1:1 by the Prisma schema.
 *
 * Declared here (not imported from @prisma/client) so the web app can use them
 * without pulling in the Prisma runtime.
 */

/**
 * Guest lifecycle.
 *
 * NOT_SENT → SENT → OPENED → CONFIRMED | DECLINED → ATTENDED
 *
 * OPENED is not a gate: a guest who opens the link and immediately confirms goes
 * SENT → CONFIRMED, and the RSVP transition rules allow it. ATTENDED is only ever
 * reached from CONFIRMED, and only by a check-in.
 */
export const GuestStatus = {
  NOT_SENT: 'NOT_SENT',
  SENT: 'SENT',
  OPENED: 'OPENED',
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  ATTENDED: 'ATTENDED',
} as const;
export type GuestStatus = (typeof GuestStatus)[keyof typeof GuestStatus];

export const GUEST_STATUSES = Object.values(GuestStatus);

/** Statuses that count as "the host still owes this guest an action". */
export const ACTIONABLE_STATUSES: GuestStatus[] = [GuestStatus.NOT_SENT];

/** Statuses that count toward confirmed seating. */
export const ATTENDING_STATUSES: GuestStatus[] = [GuestStatus.CONFIRMED, GuestStatus.ATTENDED];

export const EventType = {
  WEDDING: 'WEDDING',
  ENGAGEMENT: 'ENGAGEMENT',
  GRADUATION: 'GRADUATION',
  CORPORATE: 'CORPORATE',
  OTHER: 'OTHER',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const EventStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

/** «قائمة واحدة» vs «رجال / نساء» — the top package sells split guest lists. */
export const SectionMode = {
  SINGLE: 'SINGLE',
  SPLIT: 'SPLIT',
} as const;
export type SectionMode = (typeof SectionMode)[keyof typeof SectionMode];

export const GuestSection = {
  MEN: 'MEN',
  WOMEN: 'WOMEN',
} as const;
export type GuestSection = (typeof GuestSection)[keyof typeof GuestSection];

/**
 * The three routes to a card, as the host is asked to choose between them.
 *
 * TEMPLATE       — pick one of ours; the operator then tailors it to the event.
 * CUSTOM_REQUEST — the operator designs it from scratch, priced per request.
 * UPLOAD         — the host brings their own file.
 *
 * Mutually exclusive on purpose. The fields behind them (templateId,
 * cardImageData, customCardUrl) can all hold a value at once, and a precedence
 * rule used to be the only thing deciding which won — a rule the host could not
 * see and therefore could not predict.
 */
export const CardDesignMode = {
  TEMPLATE: 'TEMPLATE',
  CUSTOM_REQUEST: 'CUSTOM_REQUEST',
  UPLOAD: 'UPLOAD',
} as const;
export type CardDesignMode = (typeof CardDesignMode)[keyof typeof CardDesignMode];

export const CARD_DESIGN_MODES = Object.values(CardDesignMode);

/** REQUESTED → IN_PROGRESS → DELIVERED, or CANCELLED from either. */
export const DesignRequestStatus = {
  REQUESTED: 'REQUESTED',
  IN_PROGRESS: 'IN_PROGRESS',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type DesignRequestStatus =
  (typeof DesignRequestStatus)[keyof typeof DesignRequestStatus];

export const DESIGN_REQUEST_STATUSES = Object.values(DesignRequestStatus);

/** A request in one of these is still live, so a second one is refused. */
export const OPEN_DESIGN_REQUEST_STATUSES: DesignRequestStatus[] = [
  DesignRequestStatus.REQUESTED,
  DesignRequestStatus.IN_PROGRESS,
];

export const UserRole = {
  HOST: 'HOST',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentMethod = {
  MADA: 'MADA',
  CREDIT_CARD: 'CREDIT_CARD',
  APPLE_PAY: 'APPLE_PAY',
  BANK_TRANSFER: 'BANK_TRANSFER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * Scanner verdicts.
 *
 * USED never writes a CheckIn — it reports the existing one. Admitting the guest
 * anyway is a separate, explicitly-authorized override that writes a second
 * CheckIn attributed to the scanner who made the call.
 *
 * There is deliberately no REVOKED verdict. Revoking a check-in returns the
 * guest to CONFIRMED, so their next scan is simply VALID again — which is the
 * entire point of revoking. A verdict for it would be unreachable, and an
 * unreachable branch in a verdict table is what a later maintainer wires up
 * wrongly.
 */
export const ScanVerdict = {
  VALID: 'VALID',
  USED: 'USED',
  INVALID: 'INVALID',
  WRONG_EVENT: 'WRONG_EVENT',
  NOT_CONFIRMED: 'NOT_CONFIRMED',
} as const;
export type ScanVerdict = (typeof ScanVerdict)[keyof typeof ScanVerdict];

export const Locale = {
  AR: 'ar',
  EN: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export const LOCALES = Object.values(Locale);
export const DEFAULT_LOCALE: Locale = Locale.AR;
