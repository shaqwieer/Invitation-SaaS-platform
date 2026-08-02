import ExcelJS from 'exceljs';
import { hash as argonHash } from '@node-rs/argon2';
import type { Event, Guest, User } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../../src/lib/prisma.js';

export const DEFAULT_PASSWORD = 'Test@12345';

/** Distinct Saudi mobile numbers, so no test collides on the phone unique index. */
let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter += 1;
  return `+9665${String(10_000_000 + phoneCounter).slice(0, 8)}`;
}

/**
 * Wipe every table between tests.
 *
 * One TRUNCATE with CASCADE rather than per-table deletes: it ignores foreign
 * key ordering, which would otherwise have to be maintained by hand every time
 * a relation is added.
 */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createUser(
  overrides: Partial<Pick<User, 'name' | 'phone' | 'role' | 'isActive'>> & {
    password?: string;
  } = {},
): Promise<User & { plainPassword: string }> {
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? 'مضيف تجريبي',
      phone: overrides.phone ?? uniquePhone(),
      passwordHash: await argonHash(password),
      role: overrides.role ?? 'HOST',
      isActive: overrides.isActive ?? true,
    },
  });

  return Object.assign(user, { plainPassword: password });
}

export async function createEvent(hostId: string, overrides: Partial<Event> = {}): Promise<Event> {
  return prisma.event.create({
    data: {
      hostId,
      title: overrides.title ?? 'حفل زفاف تجريبي',
      type: overrides.type ?? 'WEDDING',
      status: overrides.status ?? 'ACTIVE',
      startsAt: overrides.startsAt ?? new Date('2026-11-20T17:30:00.000Z'),
      hostName: overrides.hostName ?? 'عبدالعزيز بن سعد',
      partnerName: overrides.partnerName ?? 'لمى بنت خالد',
      venueName: overrides.venueName ?? 'قاعة الماسة',
    },
  });
}

export async function createGuest(
  eventId: string,
  overrides: Partial<Pick<Guest, 'name' | 'phone' | 'group' | 'status' | 'companionsAllowed'>> = {},
): Promise<Guest> {
  return prisma.guest.create({
    data: {
      eventId,
      name: overrides.name ?? 'أ. فيصل السبيعي',
      phone: overrides.phone ?? uniquePhone(),
      group: overrides.group ?? null,
      status: overrides.status ?? 'NOT_SENT',
      companionsAllowed: overrides.companionsAllowed ?? 0,
    },
  });
}

/** Attach a package so quota-dependent behaviour can be exercised. */
export async function attachPackage(eventId: string, guestCap: number): Promise<void> {
  const pkg = await prisma.package.upsert({
    where: { key: `test-cap-${guestCap}` },
    update: { guestCap },
    create: {
      key: `test-cap-${guestCap}`,
      nameAr: `باقة ${guestCap}`,
      nameEn: `Package ${guestCap}`,
      guestCap,
      priceHalalas: 10_000,
    },
  });
  await prisma.event.update({ where: { id: eventId }, data: { packageId: pkg.id } });
}

/** Build a real .xlsx in memory so the import tests exercise the actual parser. */
export async function buildXlsx(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الضيوف');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function buildCsv(rows: Array<Array<string | number | null>>): Buffer {
  const body = rows
    .map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join(','))
    .join('\n');
  return Buffer.from(body, 'utf8');
}

export interface Session {
  user: User;
  accessToken: string;
  /** Raw Set-Cookie values, for replaying the refresh cookie. */
  cookies: string[];
  auth: () => [string, string];
}

/** Log a user in through the real HTTP surface, not by minting a token directly. */
export async function loginAs(
  app: Express,
  user: User & { plainPassword: string },
): Promise<Session> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ phone: user.phone, password: user.plainPassword });

  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return {
    user,
    accessToken: res.body.accessToken as string,
    cookies,
    auth: () => ['Authorization', `Bearer ${res.body.accessToken}`],
  };
}

/** Pull one cookie's value out of a Set-Cookie list. */
export function cookieValue(cookies: string[], name: string): string | undefined {
  for (const cookie of cookies) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}
