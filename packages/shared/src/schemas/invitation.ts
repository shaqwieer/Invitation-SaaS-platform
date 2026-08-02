import { z } from 'zod';

export const localeParamSchema = z.enum(['ar', 'en']).default('ar');

export const sendInviteSchema = z.object({
  locale: localeParamSchema,
});
export type SendInviteInput = z.infer<typeof sendInviteSchema>;

/**
 * Batch send: either an explicit selection, or everyone still unsent.
 *
 * The two correspond to the design's two entry points — «إرسال للمحدّدين» in
 * the guest table's selection bar, and «أرسلها الآن» on the dashboard's
 * "not sent yet" tile.
 */
export const bulkSendSchema = z
  .object({
    guestIds: z.array(z.string().min(1)).max(500).optional(),
    onlyUnsent: z.boolean().default(false),
    locale: localeParamSchema,
  })
  .refine((value) => value.guestIds !== undefined || value.onlyUnsent, {
    message: 'حدّد ضيوفًا أو اختر غير المُرسَل إليهم',
    path: ['guestIds'],
  });
export type BulkSendInput = z.infer<typeof bulkSendSchema>;
