import { z } from 'zod';
import { phoneField } from './common.js';

/**
 * «تصميم خاص» — the host's request, and the operator's answer to it.
 *
 * The design itself is agreed in a conversation off-platform: the operator
 * phones the host, they talk through what they want, and a price is settled.
 * These schemas carry only what the *system* needs to keep that job from being
 * lost — who to call, what they asked for, what it costs, and whether the file
 * has been delivered.
 */

export const designRequestStatusSchema = z.enum([
  'REQUESTED',
  'IN_PROGRESS',
  'DELIVERED',
  'CANCELLED',
]);

export const designRequestKindSchema = z.enum(['TEMPLATE_TAILORING', 'CUSTOM']);

export const createDesignRequestSchema = z.object({
  /**
   * Free text, capped generously. A host describing a wedding card writes
   * paragraphs — colours, verses, the couple's names in a particular
   * calligraphy — and truncating that costs the operator the brief.
   */
  notes: z.string().trim().max(2000).nullish(),
  /** Defaults to the account phone on the server when omitted. */
  contactPhone: phoneField().optional(),
});

export type CreateDesignRequestInput = z.infer<typeof createDesignRequestSchema>;

/**
 * The operator's side. Every field optional: quoting a price, moving the status
 * and writing a note are three separate moments, not one form submission.
 */
export const updateDesignRequestSchema = z.object({
  status: designRequestStatusSchema.optional(),
  /** Halalas. Null clears a quote that was given in error. */
  priceHalalas: z.number().int().min(0).max(10_000_000).nullish(),
  adminNotes: z.string().trim().max(2000).nullish(),
});

export type UpdateDesignRequestInput = z.infer<typeof updateDesignRequestSchema>;

/** What both the host's card editor and the admin panel read. */
export interface DesignRequestView {
  id: string;
  eventId: string;
  kind: z.infer<typeof designRequestKindSchema>;
  status: z.infer<typeof designRequestStatusSchema>;
  notes: string | null;
  contactPhone: string;
  priceHalalas: number | null;
  adminNotes: string | null;
  billedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The admin list adds who and what the request is for. */
export interface AdminDesignRequestView extends DesignRequestView {
  event: {
    id: string;
    title: string;
    startsAt: string;
    hasCardImage: boolean;
    host: { id: string; name: string; phone: string };
  };
}
