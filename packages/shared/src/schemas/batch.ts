import { z } from 'zod';
import { nameField, phoneField } from './common.js';
import type { GuestStatus } from '../enums.js';

/**
 * Delegated invitations — «ضيوف أم العروس».
 *
 * The host cannot invite a relative's guests, because they do not have those
 * numbers; the relative does. So the host mints a block of slots, sends *one*
 * message carrying the batch link, and the delegate distributes the invitations
 * from her own phone.
 *
 * Each slot is an ordinary guest with its own invitation, link and QR. What is
 * delegated is the sending, not the event.
 */

/**
 * How many slots one batch may hold.
 *
 * 200 is well past any real family list and far below the 5,000 per-event
 * ceiling, so a mistyped count costs a correction rather than the table.
 */
export const MAX_BATCH_SLOTS = 200;

export const createBatchSchema = z.object({
  label: z.string().trim().min(2, 'اسم الدفعة قصير جدًا').max(80, 'اسم الدفعة طويل جدًا'),
  delegateName: nameField,
  /** Where the batch link is sent. The delegate needs no account. */
  delegatePhone: phoneField('SA'),
  count: z
    .number()
    .int()
    .min(1, 'أقل عدد دعوة واحدة')
    .max(MAX_BATCH_SLOTS, `أكثر عدد ${MAX_BATCH_SLOTS} دعوة في الدفعة`),
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

/**
 * What the delegate fills in per slot. Both optional, both fill-only.
 *
 * A name she leaves blank is asked of the guest at RSVP instead; a number she
 * leaves blank means she is forwarding the link herself rather than having us
 * open WhatsApp for her.
 */
export const updateSlotSchema = z.object({
  name: z.string().trim().min(2, 'الاسم قصير جدًا').max(120, 'الاسم طويل جدًا').nullish(),
  phone: phoneField('SA').nullish(),
});
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;

const batchToken = z
  .string()
  .trim()
  .min(8, 'رابط غير صالح')
  .max(64, 'رابط غير صالح')
  // Matches the generator's alphabet. Rejecting the shape before touching the
  // database keeps enumeration probes off the query planner entirely.
  .regex(/^[0-9a-z]+$/, 'رابط غير صالح');

export const batchTokenParamSchema = z.object({ token: batchToken });

/**
 * Params for a route addressing one slot.
 *
 * `guestId` has to be declared even though nothing validates it beyond being
 * present: `validate()` **replaces** `req.params` with the parsed object, and
 * zod strips keys a schema does not mention — so a token-only schema on a
 * `/:token/slots/:guestId` route silently deletes the guest id and every
 * request 404s.
 */
export const batchSlotParamsSchema = z.object({
  token: batchToken,
  guestId: z.string().min(1),
});

/** One invitation in the delegate's list. */
export interface BatchSlotView {
  guestId: string;
  /** Null until she names them, or the guest names themselves at RSVP. */
  name: string | null;
  phone: string | null;
  status: GuestStatus;
  /** Her ordering, so «دعوة ٧ من ٥٠» stays stable as names arrive. */
  position: number;
  /** The guest's own invitation URL — what she forwards. */
  url: string;
  /**
   * The full invitation text, link included.
   *
   * Carried so «نسخ» and the native share sheet send the same words WhatsApp
   * would have been pre-filled with. A bare URL pasted into a chat arrives as a
   * link with no invitation attached to it.
   */
  message: string;
  /** Present only once she has given a number to open WhatsApp with. */
  whatsappUrl: string | null;
  sentAt: string | null;
}

/** The delegate's whole page. Deliberately carries no other guest of the event. */
export interface PublicBatch {
  label: string;
  delegateName: string;
  event: {
    title: string;
    hostName: string;
    partnerName: string | null;
    startsAt: string;
    timezone: string;
    venueName: string | null;
  };
  slots: BatchSlotView[];
  counts: { total: number; sent: number; confirmed: number };
}

/** The host's view of a batch they created. */
export interface BatchView {
  id: string;
  label: string;
  delegateName: string;
  delegatePhone: string;
  /** The link handed to the delegate. */
  url: string;
  /** Pre-filled `wa.me` for sending her that link. */
  whatsappUrl: string;
  sentAt: string | null;
  createdAt: string;
  counts: { total: number; sent: number; confirmed: number; declined: number };
}
