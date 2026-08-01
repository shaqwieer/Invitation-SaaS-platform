import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { prisma } from './prisma.js';
import { ConflictError } from './errors.js';

/**
 * Public invite tokens.
 *
 * The token is the whole of the URL's secrecy — /invite/<token> is unauthenticated,
 * so anyone holding it sees that guest's invitation. Requirements:
 *
 *   - Unguessable. 12 chars over a 32-symbol alphabet is 60 bits; brute-forcing
 *     it through a rate-limited endpoint is not a viable attack.
 *   - Not sequential and not derived from the guest. Nothing in the URL may hint
 *     at a phone number, a row id, or a position in the list.
 *   - Unambiguous when read aloud or retyped: no 0/O, 1/l/I.
 */
const TOKEN_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const TOKEN_LENGTH = 12;

const nanoid = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);

const MAX_ATTEMPTS = 5;

/**
 * Generate a token that is not already taken.
 *
 * A collision at 60 bits is vanishingly unlikely, but "unlikely" and "checked"
 * are different guarantees, and a silent collision would hand one guest another
 * guest's invitation.
 */
export async function generateInviteToken(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = nanoid();
    const existing = await prisma.invitation.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!existing) return token;
  }
  throw new ConflictError('Could not allocate a unique invite token', 'TOKEN_ALLOCATION_FAILED');
}

/**
 * Short code the door staff can type when a guest's screen is unreadable
 * ("رمز ٤٨٢١-٧٧").
 *
 * Only six digits, so it is scoped to one event and is never a substitute for
 * the signed QR payload — it is a lookup key, not a credential.
 */
export async function generateDisplayCode(eventId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const code = `${digits.slice(0, 4)}-${digits.slice(4)}`;

    const existing = await prisma.invitation.findUnique({
      where: { eventId_displayCode: { eventId, displayCode: code } },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new ConflictError('Could not allocate a unique display code', 'CODE_ALLOCATION_FAILED');
}

export const __testing = { TOKEN_ALPHABET, TOKEN_LENGTH };
