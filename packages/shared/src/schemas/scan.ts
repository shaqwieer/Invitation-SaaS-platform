import { z } from 'zod';

/**
 * The door gate.
 *
 * One password per event, plus whoever is working the door tonight. That is how
 * venues actually staff a wedding — you hand the password to the person on
 * shift, you do not provision accounts a week early. The name is optional but
 * strongly wanted: it is what makes every check-in, and especially every
 * override, attributable to a human.
 */
export const scanGateSchema = z.object({
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(128),
  displayName: z.string().trim().min(2, 'الاسم قصير جدًا').max(60).optional(),
});
export type ScanGateInput = z.infer<typeof scanGateSchema>;

/**
 * Admit a guest — by scanned QR, or by the short code / picked guest when a
 * screen is unreadable.
 *
 * Exactly one identifier: accepting several and silently preferring one makes
 * a client bug look like a scanner bug at the worst possible moment.
 */
export const checkInSchema = z
  .object({
    qrToken: z.string().min(1).max(512).optional(),
    guestId: z.string().min(1).max(64).optional(),
    displayCode: z.string().trim().min(4).max(16).optional(),
  })
  .refine(
    (value) => [value.qrToken, value.guestId, value.displayCode].filter(Boolean).length === 1,
    { message: 'أرسل رمزًا واحدًا فقط', path: ['qrToken'] },
  );
export type CheckInInput = z.infer<typeof checkInSchema>;

/**
 * Admit anyway, after a USED verdict.
 *
 * The design's edge-case note: «مستخدم سابقًا» is not a rejection. Gulf
 * companions arrive separately and hard blocking jams the door — so the staff
 * member can let them in, and the decision is recorded against their name.
 */
export const scanOverrideSchema = z.object({
  guestId: z.string().min(1).max(64),
  seats: z.number().int().min(1).max(20).default(1),
  reason: z.string().trim().max(200).optional(),
});
export type ScanOverrideInput = z.infer<typeof scanOverrideSchema>;

export const scanSearchSchema = z.object({
  q: z.string().trim().min(2, 'اكتب حرفين على الأقل').max(80),
});
export type ScanSearchInput = z.infer<typeof scanSearchSchema>;

/** No REVOKED: a revoked check-in makes the guest admittable again, so the next
 *  scan is VALID. See the note on ScanVerdict in enums.ts. */
export const scanVerdictSchema = z.enum([
  'VALID',
  'USED',
  'INVALID',
  'WRONG_EVENT',
  'NOT_CONFIRMED',
]);
export type ScanVerdictValue = z.infer<typeof scanVerdictSchema>;

export interface ScanGuestSummary {
  guestId: string;
  name: string;
  group: string | null;
  /** Guest plus companions — the number the door actually needs. */
  seats: number;
  displayCode: string;
  status: string;
}

export interface PriorCheckIn {
  scannedAt: string;
  scannedByName: string;
  seats: number;
}

export interface ScanResult {
  verdict: ScanVerdictValue;
  guest: ScanGuestSummary | null;
  /** Present on USED: the entry that already exists. */
  priorCheckIn: PriorCheckIn | null;
  checkInId: string | null;
  scannedAt: string | null;
  messageAr: string;
  messageEn: string;
}

export interface ScanSession {
  sessionToken: string;
  scanUserId: string;
  displayName: string;
  event: { id: string; title: string; venueName: string | null; startsAt: string };
}

export interface ScanStats {
  seatsAdmitted: number;
  scans: number;
  alerts: number;
  expectedSeats: number;
}

export interface ScanLogEntry {
  kind: 'CHECK_IN' | 'OVERRIDE' | 'REJECTED';
  at: string;
  guestName: string | null;
  seats: number | null;
  scannedByName: string | null;
  verdict: ScanVerdictValue | null;
  detail: string | null;
  checkInId: string | null;
}
