import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { env } from '../config/env.js';

/**
 * Guest QR codes.
 *
 * The payload is an HMAC-signed reference, never guest data. A photographed QR
 * therefore reveals nothing about who it belongs to — no name, no phone, no
 * invite URL — and cannot be forged without the server secret.
 *
 * Deliberately carries the *invitation id*, not the invitation token: the token
 * is the secret in /invite/<token>, and putting it in a QR would mean anyone who
 * photographs the screen at the door can open that guest's invitation.
 *
 * Format:  1.<eventId>.<invitationId>.<issuedAtBase36>.<signature>
 *
 * eventId travels inside the signed region so the scanner can reject a code
 * from a different wedding without a database round trip, and so an attacker
 * cannot move a valid code between events.
 */

const VERSION = '1';
const SEPARATOR = '.';

/**
 * 192 bits of a SHA-256 HMAC, base64url.
 *
 * Truncation keeps the QR small enough to scan quickly from a cracked phone
 * screen in a dim hall; 192 bits is far beyond forgery range.
 */
const SIGNATURE_LENGTH = 32;

export interface QrPayload {
  eventId: string;
  invitationId: string;
  issuedAt: Date;
}

export type QrFailureReason =
  'MALFORMED' | 'UNSUPPORTED_VERSION' | 'BAD_SIGNATURE' | 'BAD_TIMESTAMP';

export type QrVerifyResult =
  { ok: true; payload: QrPayload } | { ok: false; reason: QrFailureReason };

function sign(body: string): string {
  return crypto
    .createHmac('sha256', env().QR_HMAC_SECRET)
    .update(body)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function signQrToken(payload: QrPayload): string {
  const body = [
    VERSION,
    payload.eventId,
    payload.invitationId,
    payload.issuedAt.getTime().toString(36),
  ].join(SEPARATOR);

  return `${body}${SEPARATOR}${sign(body)}`;
}

/**
 * Verify a scanned string.
 *
 * Signature is checked with a constant-time comparison: a byte-by-byte early
 * exit leaks how much of a forged signature was correct, which is enough to
 * reconstruct one guess at a time.
 *
 * This only proves the code was minted by us and names an event and an
 * invitation. Whether that invitation is *this* event's, still confirmed, and
 * not already used is the scanner's job (phase 4).
 */
export function verifyQrToken(token: string): QrVerifyResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const parts = token.trim().split(SEPARATOR);
  if (parts.length !== 5) return { ok: false, reason: 'MALFORMED' };

  const [version, eventId, invitationId, issuedAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (version !== VERSION) return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  if (!eventId || !invitationId || !issuedAtRaw || !signature) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const body = [version, eventId, invitationId, issuedAtRaw].join(SEPARATOR);
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);

  // timingSafeEqual throws on a length mismatch, so that is checked first —
  // length is not secret, the contents are.
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const issuedAtMs = parseInt(issuedAtRaw, 36);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return { ok: false, reason: 'BAD_TIMESTAMP' };
  }

  return { ok: true, payload: { eventId, invitationId, issuedAt: new Date(issuedAtMs) } };
}

/**
 * Render a QR as a PNG.
 *
 * Error correction 'M' (~15%) rather than 'L': these get displayed on scratched
 * screens and printed on paper, and the extra redundancy costs a few modules.
 */
export async function renderQrPng(token: string, size = 512): Promise<Buffer> {
  return QRCode.toBuffer(token, {
    type: 'png',
    errorCorrectionLevel: 'M',
    width: size,
    margin: 2,
    color: { dark: '#0B2019', light: '#FFFFFF' },
  });
}

export async function renderQrDataUrl(token: string, size = 512): Promise<string> {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: 'M',
    width: size,
    margin: 2,
    color: { dark: '#0B2019', light: '#FFFFFF' },
  });
}
