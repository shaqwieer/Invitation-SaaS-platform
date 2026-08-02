import { z } from 'zod';
import { nameField, phoneField } from './common.js';

export const guestStatusSchema = z.enum([
  'NOT_SENT',
  'SENT',
  'OPENED',
  'CONFIRMED',
  'DECLINED',
  'ATTENDED',
]);

export const guestSectionSchema = z.enum(['MEN', 'WOMEN']);

/**
 * Statuses a host may set by hand.
 *
 * ATTENDED is absent deliberately: it means "walked through the door", and the
 * only thing that can assert that is a check-in. Letting a host set it would
 * make the attendance report a claim rather than a record.
 */
export const hostAssignableStatusSchema = z.enum(['NOT_SENT', 'SENT', 'CONFIRMED', 'DECLINED']);

export const createGuestSchema = z.object({
  name: nameField,
  phone: phoneField('SA'),
  group: z.string().trim().max(80).nullish(),
  section: guestSectionSchema.nullish(),
  companionsAllowed: z.number().int().min(0).max(20).default(0),
  notes: z.string().trim().max(500).nullish(),
});
export type CreateGuestInput = z.infer<typeof createGuestSchema>;

export const updateGuestSchema = createGuestSchema.partial().extend({
  status: hostAssignableStatusSchema.optional(),
  companionsConfirmed: z.number().int().min(0).max(20).optional(),
});
export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;

export const listGuestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** Matches name or phone. Digits are normalized, so "٠٥٥" finds "+96655…". */
  search: z.string().trim().max(120).optional(),
  status: guestStatusSchema.optional(),
  group: z.string().trim().max(80).optional(),
  section: guestSectionSchema.optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'name', 'status']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListGuestsQuery = z.infer<typeof listGuestsQuerySchema>;

export const guestIdParamSchema = z.object({ guestId: z.string().min(1) });

/** Bulk operations from the guest table's selection bar. */
export const bulkGuestIdsSchema = z.object({
  guestIds: z.array(z.string().min(1)).min(1, 'حدّد ضيفًا واحدًا على الأقل').max(500),
});
export type BulkGuestIdsInput = z.infer<typeof bulkGuestIdsSchema>;

export const bulkStatusSchema = bulkGuestIdsSchema.extend({
  status: hostAssignableStatusSchema,
});
export type BulkStatusInput = z.infer<typeof bulkStatusSchema>;

export interface GuestStatusCounts {
  total: number;
  NOT_SENT: number;
  SENT: number;
  OPENED: number;
  CONFIRMED: number;
  DECLINED: number;
  ATTENDED: number;
}
