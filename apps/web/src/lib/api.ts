import type { PublicInvitation } from '@da3wa/shared';

/**
 * Where the server talks to the API.
 *
 * Inside Docker the API is reachable as `api:4000` on the compose network,
 * while the browser must use the published `localhost:4000` — so server and
 * client resolve different bases for the same service.
 */
export function serverApiBase(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export function browserApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
    headers: { accept: 'application/json' },
  });

  if (res.status === 404 || res.status === 422) return null;

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', 'Failed to load invitation');
  }

  return (await res.json()) as PublicInvitation;
}
