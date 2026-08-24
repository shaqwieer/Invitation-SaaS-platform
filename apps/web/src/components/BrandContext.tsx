'use client';

import { createContext, useContext } from 'react';
import type { PublicBranding } from '@da3wa/shared';

/**
 * Operator-set branding, handed down from the root layout.
 *
 * Fetched once on the server and passed through context rather than fetched by
 * each component: the logo appears on every screen, and a request per instance
 * would mean four calls to render one page.
 *
 * The default value is the shipped identity, so a component rendered outside
 * the provider still draws something rather than throwing.
 */
const FALLBACK: PublicBranding = {
  // Kept in step with FALLBACK_BRANDING in lib/api.server.ts — the same shipped
  // identity, one for the server fetch and one for a component rendered outside
  // the provider.
  brandNameAr: 'يا هلا',
  brandNameEn: 'Yahla',
  taglineAr: 'منصة سعودية للدعوات الرقمية وإدارة حضور المناسبات.',
  taglineEn: 'A Saudi platform for digital invitations and event attendance.',
  logoMark: 'ي',
  logoUrl: null,
  customDesignPriceHalalas: 19_900,
};

const BrandCtx = createContext<PublicBranding>(FALLBACK);

export function BrandProvider({
  branding,
  children,
}: {
  branding: PublicBranding;
  children: React.ReactNode;
}) {
  return <BrandCtx.Provider value={branding}>{children}</BrandCtx.Provider>;
}

export function useBrand(): PublicBranding {
  return useContext(BrandCtx);
}
