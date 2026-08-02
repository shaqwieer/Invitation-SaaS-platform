import { z } from 'zod';
import { nameField, passwordField } from './common.js';

export const eventTypeSchema = z.enum([
  'WEDDING',
  'ENGAGEMENT',
  'GRADUATION',
  'CORPORATE',
  'OTHER',
]);
export const eventStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
export const sectionModeSchema = z.enum(['SINGLE', 'SPLIT']);

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'اللون يجب أن يكون بصيغة #RRGGBB');

/** Shared by create and update so the two can never drift apart. */
const eventCore = {
  title: z.string().trim().min(2, 'اسم المناسبة قصير جدًا').max(160, 'اسم المناسبة طويل جدًا'),
  type: eventTypeSchema.default('WEDDING'),
  sectionMode: sectionModeSchema.default('SINGLE'),

  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  timezone: z.string().min(1).max(64).default('Asia/Riyadh'),

  hostName: nameField,
  partnerName: z.string().trim().min(2).max(120).nullish(),

  venueName: z.string().trim().max(160).nullish(),
  venueAddress: z.string().trim().max(300).nullish(),
  venueLat: z.number().min(-90).max(90).nullish(),
  venueLng: z.number().min(-180).max(180).nullish(),
  venueMapUrl: z.string().url().max(500).nullish(),

  templateId: z.string().min(1).nullish(),
  packageId: z.string().min(1).nullish(),
  cardColor: hexColour.default('#0E5A45'),
  cardTitleFont: z.enum(['amiri', 'plex-arabic']).default('amiri'),
  customCardUrl: z.string().url().max(500).nullish(),

  rsvpDeadline: z.coerce.date().nullish(),
  defaultCompanionsAllowed: z.number().int().min(0).max(20).default(0),

  whatsappTemplateAr: z.string().trim().min(1).max(1000).optional(),
  whatsappTemplateEn: z.string().trim().min(1).max(1000).optional(),
};

/**
 * An event whose RSVP deadline falls after it starts, or which ends before it
 * begins, is not a validation nicety — the invite page uses the deadline to
 * decide whether a guest may still change their answer.
 */
function checkDates(
  data: { startsAt?: Date; endsAt?: unknown; rsvpDeadline?: unknown },
  ctx: z.RefinementCtx,
): void {
  const { startsAt } = data;
  if (!startsAt) return;

  const endsAt = data.endsAt as Date | null | undefined;
  if (endsAt instanceof Date && endsAt.getTime() <= startsAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'وقت الانتهاء يجب أن يكون بعد وقت البدء',
    });
  }

  const deadline = data.rsvpDeadline as Date | null | undefined;
  if (deadline instanceof Date && deadline.getTime() > startsAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rsvpDeadline'],
      message: 'آخر موعد للرد يجب أن يكون قبل بداية المناسبة',
    });
  }
}

export const createEventSchema = z.object(eventCore).superRefine(checkDates);
export type CreateEventInput = z.infer<typeof createEventSchema>;

/**
 * Every field optional — the design's wizard saves a draft after each step, so
 * partial writes are the normal case rather than an edge one.
 */
export const updateEventSchema = z
  .object(eventCore)
  // .partial() wraps each field in ZodOptional, which short-circuits on
  // undefined — so an absent key means "leave unchanged" rather than "reset to
  // the create-time default".
  .partial()
  .extend({
    status: eventStatusSchema.optional(),
    /** Plaintext; hashed before storage. Null clears it and closes the scanner gate. */
    scannerPassword: passwordField.nullish(),
  })
  .superRefine(checkDates);

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const eventIdParamSchema = z.object({ eventId: z.string().min(1) });
