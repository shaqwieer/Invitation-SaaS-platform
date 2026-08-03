import 'server-only';
import { headers } from 'next/headers';
import type { PublicBatch, PublicBranding, PublicInvitation } from '@da3wa/shared';
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
 * Operator-set branding, for server rendering.
 *
 * `no-store`, deliberately, even though this is identical for every visitor.
 * It was cached for 60s at first, and the result was that an admin saved a new
 * name, the page reloaded, and the old one came back — indistinguishable from
 * the save having failed. A settings screen that appears not to work is worse
 * than one indexed lookup per render, which is what this costs.
 *
 * If that ever shows up in a profile, the fix is a tagged cache the admin save
 * revalidates — not a longer TTL.
 *
 * Falls back to the shipped identity if the API is unreachable: the logo being
 * momentarily unavailable must not blank the page it sits on.
 */
export const FALLBACK_BRANDING: PublicBranding = {
  brandNameAr: 'دعوة',
  brandNameEn: 'Da3wa',
  taglineAr: 'منصة سعودية للدعوات الرقمية وإدارة حضور المناسبات.',
  taglineEn: 'A Saudi platform for digital invitations and event attendance.',
  logoMark: 'د',
  logoUrl: null,
  customDesignPriceHalalas: 19_900,
};

export async function fetchBranding(): Promise<PublicBranding> {
  try {
    const res = await fetch(`${serverApiBase()}/api/settings`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return FALLBACK_BRANDING;
    const body = (await res.json()) as { branding?: PublicBranding };
    return body.branding ?? FALLBACK_BRANDING;
  } catch {
    return FALLBACK_BRANDING;
  }
}

export interface CataloguePackage {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  guestCap: number;
  priceHalalas: number;
  scannerSeats: number;
  featuresAr: string[];
  featuresEn: string[];
  isHighlighted: boolean;
}

/**
 * The public price list, for the landing page.
 *
 * Revalidated rather than `no-store`: unlike an invitation this is the same for
 * everyone, so it is safe to cache — and a marketing page should not put a round
 * trip to the API in front of every visitor. Five minutes is short enough that a
 * price change is live before anyone notices.
 *
 * Returns an empty list on failure: the API being briefly down should cost the
 * pricing section, not the whole landing page.
 */
export async function fetchPackages(): Promise<CataloguePackage[]> {
  try {
    const res = await fetch(`${serverApiBase()}/api/catalogue`, {
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { packages?: CataloguePackage[] };
    return body.packages ?? [];
  } catch {
    return [];
  }
}

export interface CatalogueTemplate {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  category: string;
  previewImageUrl: string | null;
  priceHalalas: number;
}

/**
 * The public template gallery.
 *
 * Shares `/api/catalogue` and its five-minute window with `fetchPackages`, so
 * the landing page and the sample invitation cost one round trip between them
 * rather than two.
 */
export async function fetchTemplates(): Promise<CatalogueTemplate[]> {
  try {
    const res = await fetch(`${serverApiBase()}/api/catalogue`, {
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { templates?: CatalogueTemplate[] };
    return body.templates ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch a delegate's batch for server rendering.
 *
 * `no-store` for the same reason as an invitation, and a stronger one: this
 * page lists a whole block of named guests and their numbers. Nothing about it
 * may be reused for a different token.
 */
export async function fetchBatch(token: string): Promise<PublicBatch | null> {
  const res = await fetch(`${serverApiBase()}/api/batch/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: forwardedClientHeaders(),
  });

  if (res.status === 404 || res.status === 422) return null;

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', 'Failed to load batch');
  }

  const body = (await res.json()) as { batch: PublicBatch };
  return body.batch;
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
