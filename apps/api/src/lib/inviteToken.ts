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

/**
 * Allocate many tokens and codes at once, for minting a block of invitations.
 *
 * Calling the single-value generators in a loop is two round trips per slot —
 * 200 slots means 400 queries just to decide what to name things. This asks the
 * database twice in total: generate a candidate set, subtract whatever is
 * already taken, top up if the (vanishingly rare) subtraction left a hole.
 *
 * Candidates are de-duplicated within the batch as well as against storage.
 * Two identical tokens in one `createMany` would fail the whole insert, and two
 * identical display codes would collide on `@@unique([eventId, displayCode])`.
 */
export async function generateInviteIdentifiers(
  eventId: string,
  count: number,
): Promise<Array<{ token: string; displayCode: string }>> {
  const tokens = new Set<string>();
  const codes = new Set<string>();

  for (let attempt = 0; attempt < MAX_ATTEMPTS && tokens.size < count; attempt++) {
    while (tokens.size < count) tokens.add(nanoid());

    const taken = await prisma.invitation.findMany({
      where: { token: { in: [...tokens] } },
      select: { token: true },
    });
    for (const row of taken) tokens.delete(row.token);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS && codes.size < count; attempt++) {
    while (codes.size < count) {
      const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      codes.add(`${digits.slice(0, 4)}-${digits.slice(4)}`);
    }

    const taken = await prisma.invitation.findMany({
      // Display codes are unique per event, so only this event's are in the way.
      where: { eventId, displayCode: { in: [...codes] } },
      select: { displayCode: true },
    });
    for (const row of taken) codes.delete(row.displayCode);
  }

  if (tokens.size < count) {
    throw new ConflictError('Could not allocate unique invite tokens', 'TOKEN_ALLOCATION_FAILED');
  }
  if (codes.size < count) {
    throw new ConflictError('Could not allocate unique display codes', 'CODE_ALLOCATION_FAILED');
  }

  const tokenList = [...tokens];
  const codeList = [...codes];

  return Array.from({ length: count }, (_, index) => ({
    token: tokenList[index]!,
    displayCode: codeList[index]!,
  }));
}

export const __testing = { TOKEN_ALPHABET, TOKEN_LENGTH };
