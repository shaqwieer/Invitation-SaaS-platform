/**
 * WhatsApp delivery without the Business API.
 *
 * The product's central promise, and the first objection a Gulf host raises:
 * «هل تُرسل الدعوات من رقمي أنا؟» — yes. We never send anything. We build a
 * `wa.me` deep link per guest, pre-filled with their name and their private
 * URL, and the host taps it. The message leaves the host's own number, from
 * their own WhatsApp, which is why open rates are what they are.
 */
import { toWhatsAppNumber } from './phone.js';

export interface MessageVariables {
  /** Guest's name, as the host entered it. */
  name: string;
  /** Absolute invite URL. */
  url: string;
  eventTitle?: string;
  hostName?: string;
  /** Pre-formatted for the message's locale — this module does not format dates. */
  eventDate?: string;
  venue?: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Substitute {{name}}, {{url}} and friends into a host's template.
 *
 * An unknown placeholder is left verbatim rather than replaced with "undefined":
 * a host who typed `{{ time }}` should see their own text and notice, not send
 * three hundred people the word "undefined".
 */
export function renderMessage(template: string, vars: MessageVariables): string {
  const lookup = vars as unknown as Record<string, string | undefined>;

  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = lookup[key];
    return value === undefined ? match : value;
  });
}

/**
 * Build the deep link the host taps.
 *
 * `wa.me/<digits>` — no '+', no spaces, no punctuation, or WhatsApp fails to
 * resolve the contact. The message goes through encodeURIComponent so Arabic
 * text, newlines and the URL's own characters all survive the query string.
 */
export function buildWhatsAppLink(phoneE164: string, message: string): string {
  const digits = toWhatsAppNumber(phoneE164);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** The guest-facing URL. Kept in one place so it cannot drift between callers. */
export function buildInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/invite/${token}`;
}

export interface BuildInvitePayload {
  phone: string;
  name: string;
  token: string;
  template: string;
  baseUrl: string;
  extras?: Omit<MessageVariables, 'name' | 'url'>;
}

export interface InviteLink {
  url: string;
  message: string;
  whatsappUrl: string;
}

export function buildInviteLink(payload: BuildInvitePayload): InviteLink {
  const url = buildInviteUrl(payload.baseUrl, payload.token);
  const message = renderMessage(payload.template, {
    name: payload.name,
    url,
    ...payload.extras,
  });

  return { url, message, whatsappUrl: buildWhatsAppLink(payload.phone, message) };
}
