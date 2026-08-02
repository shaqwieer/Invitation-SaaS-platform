import 'server-only';
import { headers } from 'next/headers';
import type { PublicInvitation } from '@da3wa/shared';
import { ApiError } from './api';

/**
 * Where the *server* talks to the API.
 *
 * Inside Docker the API is reachable as `api:4000` on the compose network,
 * while the browser must use the published origin — so the two resolve
 * different bases for the same service.
 */
export function serverApiBase(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

/**
 * Carry the real client IP through to the API.
 *
 * Without this, every server-rendered invite lookup reaches the API from the
 * *web container's* address, so every guest on the platform shares a single
 * rate-limit bucket. At 30 lookups a minute that means a host batch-sends a
 * hundred invitations, guests start tapping, and everyone past the thirtieth
 * sees «تعذّر تحميل الدعوة» — the feature failing precisely when it is used.
 *
 * Forwarding the header verbatim is safe rather than spoofable: nginx *appends*
 * the real peer to whatever the client sent, and Express (`TRUST_PROXY=1`) reads
 * the rightmost entry, which is the one nginx wrote.
 */
function forwardedClientHeaders(): Record<string, string> {
  const forwarded: Record<string, string> = { accept: 'application/json' };

  try {
    const incoming = headers();
    const chain = incoming.get('x-forwarded-for') ?? incoming.get('x-real-ip');
    if (chain) forwarded['x-forwarded-for'] = chain;
    const proto = incoming.get('x-forwarded-proto');
    if (proto) forwarded['x-forwarded-proto'] = proto;
  } catch {
    // headers() throws outside a request scope; the fetch still works, it just
    // falls back to the container address.
  }

  return forwarded;
}

/**
 * Fetch an invitation for server rendering.
 *
 * `cache: 'no-store'` is essential: an invitation contains a guest's name and
 * their answer, and Next would otherwise happily serve one guest's page to
 * another from the full route cache.
 */
export async function fetchInvitation(token: string): Promise<PublicInvitation | null> {
  const res = await fetch(`${serverApiBase()}/api/invite/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: forwardedClientHeaders(),
  });

  if (res.status === 404 || res.status === 422) return null;

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', 'Failed to load invitation');
  }

  return (await res.json()) as PublicInvitation;
}
