import type { GuestStatusCounts } from './guest.js';

/**
 * Shapes the host dashboard (§03) and the post-event report (§12) render.
 *
 * Rates are ratios in 0–1, never pre-formatted percentages: the display style
 * differs between Arabic (٥٨٪) and English (58%), and a server that has already
 * decided cannot serve both.
 */
export interface DashboardSummary {
  event: {
    id: string;
    title: string;
    startsAt: string;
    timezone: string;
    venueName: string | null;
    status: string;
    /** Negative once the event is in the past. */
    daysUntil: number;
  };

  counts: GuestStatusCounts;

  seats: {
    /** Seats promised by confirmed (and already-arrived) guests. */
    confirmed: number;
    /** Seats actually admitted at the door. */
    attended: number;
    /** Every seat that would exist if all invitees confirmed their full allowance. */
    potential: number;
  };

  rates: {
    /** Answered ÷ contacted. */
    response: number;
    /** Confirmed ÷ all invited. */
    confirmation: number;
    /** Arrived ÷ confirmed seats. Null before anyone has been admitted. */
    attendance: number | null;
  };

  averages: {
    companionsPerConfirmedGuest: number;
    /** Hours between the invitation being sent and the guest answering. */
    responseHours: number | null;
  };

  quota: { cap: number | null; used: number; remaining: number | null; exceeded: boolean };

  /** Guests contacted but silent — the number the reminder nudge acts on. */
  awaitingReply: { count: number; oldestSentDaysAgo: number | null };

  /**
   * `NOT_SENT` split by who can actually send it.
   *
   * Delegated slots sit in NOT_SENT like any other unsent invitation, but they
   * have no number — they are waiting on the person distributing them, not on
   * the host. Without the split, «أرسلها الآن» offers to send fifty invitations
   * and then prepares none of them.
   */
  pendingSend: { sendable: number; delegated: number };

  activity: ActivityEntry[];

  /** Stamped server-side so the UI can show «آخر تحديث قبل دقيقتين» honestly. */
  updatedAt: string;
}

export type ActivityKind =
  'CONFIRMED' | 'DECLINED' | 'CHECKED_IN' | 'INVITES_SENT' | 'GUESTS_IMPORTED';

export interface ActivityEntry {
  kind: ActivityKind;
  at: string;
  guestName: string | null;
  /** Companions on an RSVP, or the batch size on a send/import. */
  count: number | null;
}

// ─── Post-event report (§12) ─────────────────────────────────────────────────

export interface AttendanceReport {
  event: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string | null;
    timezone: string;
    venueName: string | null;
    venueAddress: string | null;
  };

  /** The headline number: what the host plans next year's catering on. */
  headline: {
    attendedSeats: number;
    confirmedSeats: number;
    /** Arrived ÷ confirmed. Null when nobody confirmed. */
    complianceRate: number | null;
  };

  counts: {
    invited: number;
    confirmed: number;
    declined: number;
    /** Confirmed, never scanned — the empty chairs. */
    confirmedNoShow: number;
    noShowSeats: number;
  };

  /** Half-hour buckets, ascending. Drives «توزيع الوصول بالساعة». */
  arrivals: Array<{ at: string; seats: number; scans: number; isPeak: boolean }>;

  byGroup: Array<{
    group: string;
    attendedSeats: number;
    confirmedSeats: number;
    rate: number;
  }>;

  noShows: Array<{ guestId: string; name: string; seats: number; group: string | null }>;

  timings: {
    firstEntry: string | null;
    lastEntry: string | null;
    /** Median gap between consecutive scans — the venue's throughput. */
    medianScanGapSeconds: number | null;
  };
}
