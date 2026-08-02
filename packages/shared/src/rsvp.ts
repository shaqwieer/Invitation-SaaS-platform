/**
 * RSVP transition rules.
 *
 * Pure, so the same rules drive the API's guard and the invite page's UI — a
 * guest should never see a live "أعتذر" button for an answer the server will
 * refuse.
 *
 * Shape of the decision, from the design (§07): the companion count is chosen
 * *before* the confirm button, so a response is one atomic answer — "yes, and
 * we are four" — not a confirmation followed by a second question.
 */
import { GuestStatus } from './enums.js';

export type RsvpBlockReason =
  'ALREADY_ATTENDED' | 'DEADLINE_PASSED' | 'EVENT_NOT_ACTIVE' | 'TOO_MANY_COMPANIONS';

export interface RsvpDecision {
  allowed: boolean;
  reason?: RsvpBlockReason;
  messageAr?: string;
  messageEn?: string;
}

const ALLOWED: RsvpDecision = { allowed: true };

function block(reason: RsvpBlockReason, messageAr: string, messageEn: string): RsvpDecision {
  return { allowed: false, reason, messageAr, messageEn };
}

export interface RsvpContext {
  status: GuestStatus;
  /** Null means "no deadline" — answers stay open indefinitely. */
  rsvpDeadline?: Date | string | null;
  eventStatus?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  now?: Date;
}

/**
 * May this guest submit (or change) an answer right now?
 *
 * Changing a reply is explicitly allowed — the design says so on both result
 * screens («يمكنك تغيير ردّك لاحقًا», «أستطيع الحضور بعد كل شيء»). The only
 * one-way door is ATTENDED: once someone has walked through the gate, the
 * record of that is not theirs to edit.
 */
export function canRespond(context: RsvpContext): RsvpDecision {
  const now = context.now ?? new Date();

  if (context.status === GuestStatus.ATTENDED) {
    return block(
      'ALREADY_ATTENDED',
      'تم تسجيل حضورك بالفعل',
      'Your attendance has already been recorded',
    );
  }

  if (context.eventStatus === 'CANCELLED') {
    return block('EVENT_NOT_ACTIVE', 'أُلغيت هذه المناسبة', 'This event has been cancelled');
  }

  if (context.rsvpDeadline) {
    const deadline = new Date(context.rsvpDeadline);
    if (Number.isFinite(deadline.getTime()) && now.getTime() > deadline.getTime()) {
      return block('DEADLINE_PASSED', 'انتهى موعد الرد على الدعوة', 'The RSVP deadline has passed');
    }
  }

  return ALLOWED;
}

/** Companions are bounded by what the host allowed for this guest. */
export function checkCompanions(companions: number, companionsAllowed: number): RsvpDecision {
  if (!Number.isInteger(companions) || companions < 0) {
    return block('TOO_MANY_COMPANIONS', 'عدد المرافقين غير صالح', 'Invalid companion count');
  }

  if (companions > companionsAllowed) {
    return block(
      'TOO_MANY_COMPANIONS',
      `الحد المسموح ${companionsAllowed} مرافقين`,
      `At most ${companionsAllowed} companions are allowed`,
    );
  }

  return ALLOWED;
}

/** The status an answer projects to. */
export function statusForResponse(attending: boolean): GuestStatus {
  return attending ? GuestStatus.CONFIRMED : GuestStatus.DECLINED;
}

/**
 * Status after a guest opens their link.
 *
 * OPENED is observational and must never overwrite a real answer — a confirmed
 * guest re-reading their invitation is still confirmed. It only advances the
 * two states that precede any answer.
 */
export function statusAfterOpen(current: GuestStatus): GuestStatus {
  return current === GuestStatus.NOT_SENT || current === GuestStatus.SENT
    ? GuestStatus.OPENED
    : current;
}

/** Seats a confirmed guest occupies: themselves plus companions. */
export function seatsFor(companionsConfirmed: number): number {
  return companionsConfirmed + 1;
}
