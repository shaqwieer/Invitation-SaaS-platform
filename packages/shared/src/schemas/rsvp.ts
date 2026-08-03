import { z } from 'zod';

/**
 * One atomic answer.
 *
 * `attending` and `companions` arrive together because the design puts the
 * companion picker *above* the confirm button: in Gulf families the real answer
 * is "how many", and splitting it across two requests loses accuracy every time
 * someone taps confirm and closes the page.
 */
export const respondSchema = z
  .object({
    attending: z.boolean(),
    companions: z.number().int().min(0).max(20).default(0),
  })
  .transform((value) => ({
    ...value,
    // A declining guest brings nobody, whatever the picker happened to show.
    companions: value.attending ? value.companions : 0,
  }));

export type RespondInput = z.infer<typeof respondSchema>;

export const inviteTokenParamSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8, 'رابط غير صالح')
    .max(64, 'رابط غير صالح')
    // Matches the generator's alphabet. Rejecting the shape before touching the
    // database keeps enumeration probes off the query planner entirely.
    .regex(/^[0-9a-z]+$/, 'رابط غير صالح'),
});

/** What the public invite page renders. Deliberately omits everything else. */
export interface PublicInvitation {
  guest: {
    name: string;
    companionsAllowed: number;
    companionsConfirmed: number;
    status: 'NOT_SENT' | 'SENT' | 'OPENED' | 'CONFIRMED' | 'DECLINED' | 'ATTENDED';
  };
  event: {
    title: string;
    type: string;
    hostName: string;
    partnerName: string | null;
    startsAt: string;
    endsAt: string | null;
    timezone: string;
    venueName: string | null;
    venueAddress: string | null;
    venueLat: number | null;
    venueLng: number | null;
    venueMapUrl: string | null;
    cardColor: string;
    cardTitleFont: string;
    customCardUrl: string | null;
    templateKey: string | null;
    /**
     * The artwork to draw behind the card, already resolved by the server.
     *
     * Three sources can supply it — an upload, a URL the host pasted, or the
     * chosen template's preview image — and picking between them is a rule, not
     * a preference. Resolving it once here means the guest page and the host's
     * editor cannot disagree about which one wins.
     *
     * Null means no artwork: the card is drawn in `cardColor` alone.
     */
    cardArtworkUrl: string | null;
    rsvpDeadline: string | null;
    sectionMode: string;
  };
  invitation: {
    displayCode: string;
    respondedAt: string | null;
  };
  /** Whether an answer is currently accepted, and why not if it isn't. */
  canRespond: { allowed: boolean; reason?: string; messageAr?: string; messageEn?: string };
}
