import { z } from 'zod';
import { eventStatusSchema, eventTypeSchema } from './event.js';

/**
 * Operator-facing management.
 *
 * Deliberately narrow: an admin can change a user's role, disable an account,
 * grant an event extra headroom, and edit the catalogue. They cannot edit a
 * host's guests or answer on a guest's behalf — those are the host's data and
 * the guest's word, and no support ticket is worth a back door into either.
 */
export const updateUserSchema = z.object({
  role: z.enum(['HOST', 'ADMIN']).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(120).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const adminUpdateEventSchema = z.object({
  status: eventStatusSchema.optional(),
  /** Support granting headroom without changing what the host bought. */
  guestCapOverride: z.number().int().min(0).max(10_000).nullable().optional(),
  packageId: z.string().min(1).nullable().optional(),
});
export type AdminUpdateEventInput = z.infer<typeof adminUpdateEventSchema>;

const catalogueName = z.string().trim().min(2).max(120);

export const upsertPackageSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'المعرّف يقبل الحروف اللاتينية الصغيرة والأرقام والشرطة فقط'),
  nameAr: catalogueName,
  nameEn: catalogueName,
  guestCap: z.number().int().min(1).max(10_000),
  /** Integer halalas, like every amount in the system. */
  priceHalalas: z.number().int().min(0).max(10_000_000),
  scannerSeats: z.number().int().min(1).max(20).default(1),
  featuresAr: z.array(z.string().trim().max(160)).max(12).default([]),
  featuresEn: z.array(z.string().trim().max(160)).max(12).default([]),
  isHighlighted: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type UpsertPackageInput = z.infer<typeof upsertPackageSchema>;

export const upsertTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'المعرّف يقبل الحروف اللاتينية الصغيرة والأرقام والشرطة فقط'),
  nameAr: catalogueName,
  nameEn: catalogueName,
  category: eventTypeSchema.default('WEDDING'),
  previewImageUrl: z.string().url().max(500).nullish(),
  priceHalalas: z.number().int().min(0).max(10_000_000).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type UpsertTemplateInput = z.infer<typeof upsertTemplateSchema>;

export const adminListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export interface PlatformStats {
  users: number;
  events: number;
  guests: number;
  paidOrders: number;
  revenueHalalas: number;
}

/**
 * Operator-editable branding.
 *
 * `logoMark` is capped at two characters because it is a single glyph drawn in
 * a fixed square — a word would overflow it rather than shrink to fit, and the
 * failure would only show up on the live site.
 */
export const updateSettingsSchema = z.object({
  brandNameAr: z.string().trim().min(1).max(60),
  brandNameEn: z.string().trim().min(1).max(60),
  taglineAr: z.string().trim().max(240),
  taglineEn: z.string().trim().max(240),
  logoMark: z.string().trim().min(1).max(2),
  /**
   * Halalas. The "from" price a custom design is advertised at, and what the
   * operator's quote form starts from — the agreed figure still lands on the
   * request row.
   */
  customDesignPriceHalalas: z.number().int().min(0).max(10_000_000).default(19_900),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** What the public branding endpoint returns. Never includes the logo bytes. */
export interface PublicBranding {
  brandNameAr: string;
  brandNameEn: string;
  taglineAr: string;
  taglineEn: string;
  logoMark: string;
  /** Null when no image is uploaded and the mark should be drawn instead. */
  logoUrl: string | null;
  /** Advertised "from" price for a custom design, in halalas. */
  customDesignPriceHalalas: number;
}
