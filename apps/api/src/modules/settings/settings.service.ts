import type { PublicBranding, UpdateSettingsInput } from '@da3wa/shared';
import { prisma } from '../../lib/prisma.js';

/** The one row. */
export const SETTINGS_ID = 'singleton';

/**
 * Read the settings, creating them on first use.
 *
 * An upsert rather than a findUnique so a fresh database — or a deploy that ran
 * migrations but no seed — still serves branding instead of 500ing on the
 * landing page. Every column has a default, so the created row is exactly the
 * shipped identity.
 */
export async function getSettings() {
  return prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

/**
 * The shape the public endpoint and the web app share.
 *
 * `logoVersion` rides along in the URL so a replaced logo busts any cache that
 * held the old one — without it an operator uploads a new logo and keeps seeing
 * the previous one until something expires.
 */
export function toPublicBranding(settings: {
  brandNameAr: string;
  brandNameEn: string;
  taglineAr: string;
  taglineEn: string;
  logoMark: string;
  logoMime: string | null;
  logoVersion: number;
}): PublicBranding {
  return {
    brandNameAr: settings.brandNameAr,
    brandNameEn: settings.brandNameEn,
    taglineAr: settings.taglineAr,
    taglineEn: settings.taglineEn,
    logoMark: settings.logoMark,
    logoUrl: settings.logoMime ? `/api/settings/logo?v=${settings.logoVersion}` : null,
  };
}

export async function updateSettings(input: UpdateSettingsInput) {
  return prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    update: input,
    create: { id: SETTINGS_ID, ...input },
  });
}

export async function setLogo(data: Buffer, mime: string) {
  const current = await getSettings();
  return prisma.platformSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      // Prisma's Bytes maps to Uint8Array<ArrayBuffer>, while multer hands back
      // a Buffer whose backing store is ArrayBufferLike. Copying into a plain
      // Uint8Array satisfies both and detaches from multer's pooled memory.
      logoData: new Uint8Array(data),
      logoMime: mime,
      logoVersion: current.logoVersion + 1,
    },
  });
}

/** Clearing the image falls back to the drawn mark rather than to nothing. */
export async function clearLogo() {
  const current = await getSettings();
  return prisma.platformSettings.update({
    where: { id: SETTINGS_ID },
    data: { logoData: null, logoMime: null, logoVersion: current.logoVersion + 1 },
  });
}
