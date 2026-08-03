/**
 * Demo data: the catalogue, one host, and the wedding from the design doc.
 *
 * Re-runnable. The catalogue is upserted; the demo event is torn down and
 * rebuilt so the guest mix is always exactly what the dashboard screenshots show.
 */
import { hash as argonHash } from '@node-rs/argon2';
import { PrismaClient, type GuestStatus } from '@prisma/client';
import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';

const prisma = new PrismaClient();

const nanoid = customAlphabet('23456789abcdefghijkmnpqrstuvwxyz', 12);
const sar = (amount: number) => amount * 100;

const DEMO_HOST_PHONE = '+966500000000';
const DEMO_HOST_PASSWORD = 'Demo@1234';
const DEMO_SCANNER_PASSWORD = 'door1234';

const PACKAGES = [
  {
    key: 'family-100',
    nameAr: 'باقة العائلة',
    nameEn: 'Family',
    guestCap: 100,
    priceHalalas: sar(249),
    scannerSeats: 1,
    featuresAr: ['١٠٠ رابط دعوة شخصي', 'رموز QR وماسح الاستقبال', '٦ قوالب جاهزة'],
    featuresEn: ['100 personal invite links', 'QR codes and door scanner', '6 ready templates'],
    isHighlighted: false,
    sortOrder: 1,
  },
  {
    key: 'event-300',
    nameAr: 'باقة المناسبة',
    nameEn: 'Event',
    guestCap: 300,
    priceHalalas: sar(449),
    scannerSeats: 1,
    featuresAr: [
      '٣٠٠ رابط دعوة شخصي',
      'تذكير تلقائي لمن لم يردّ',
      'جميع القوالب + تعديل الألوان',
      'تقرير الحضور بعد المناسبة',
    ],
    featuresEn: [
      '300 personal invite links',
      'Automatic reminders for non-responders',
      'All templates + colour editing',
      'Post-event attendance report',
    ],
    isHighlighted: true,
    sortOrder: 2,
  },
  {
    key: 'palace-600',
    nameAr: 'باقة القصر',
    nameEn: 'Palace',
    guestCap: 600,
    priceHalalas: sar(749),
    scannerSeats: 3,
    featuresAr: [
      '٦٠٠ رابط دعوة شخصي',
      '٣ حسابات استقبال للماسح',
      'قائمتان منفصلتان (رجال/نساء)',
      'دعم عبر واتساب طوال المناسبة',
    ],
    featuresEn: [
      '600 personal invite links',
      '3 scanner seats',
      'Split men/women lists',
      'WhatsApp support throughout the event',
    ],
    isHighlighted: false,
    sortOrder: 3,
  },
] as const;

const TEMPLATES = [
  {
    key: 'classic',
    nameAr: 'كلاسيكي',
    nameEn: 'Classic',
    category: 'WEDDING',
    priceHalalas: 0,
    sortOrder: 1,
  },
  {
    key: 'minimal',
    nameAr: 'مينيمال',
    nameEn: 'Minimal',
    category: 'GRADUATION',
    priceHalalas: 0,
    sortOrder: 2,
  },
  {
    key: 'floral-modern',
    nameAr: 'زهري عصري',
    nameEn: 'Floral modern',
    category: 'ENGAGEMENT',
    priceHalalas: 0,
    sortOrder: 3,
  },
] as const;

/**
 * Templates the catalogue used to carry that are no longer designs.
 *
 * «تصميمك أنت» was a catalogue row so the old dropdown could offer it beside
 * the real templates. It is a *route* to a card — `CardDesignMode.UPLOAD` — not
 * a card, and leaving it in the gallery would put a tile reading "your own
 * design" among the actual artwork. Deactivated rather than deleted: events
 * already pointing at it keep a valid reference.
 */
const RETIRED_TEMPLATE_KEYS = ['custom-upload'];

interface SeedGuest {
  name: string;
  phone: string;
  group: string;
  companionsAllowed: number;
  companionsConfirmed: number;
  status: GuestStatus;
}

const GROOM = 'عائلة العريس';
const BRIDE = 'عائلة العروس';
const FRIENDS = 'صديقات العروس';
const WORK = 'زملاء العمل';
const NEIGHBOURS = 'جيران';

/** 20 guests spanning every status, so the dashboard has all five tiles populated. */
const GUESTS: SeedGuest[] = [
  {
    name: 'أ. فيصل السبيعي',
    phone: '+966554128830',
    group: GROOM,
    companionsAllowed: 3,
    companionsConfirmed: 3,
    status: 'CONFIRMED',
  },
  {
    name: 'م. نورة القحطاني',
    phone: '+966507331120',
    group: FRIENDS,
    companionsAllowed: 2,
    companionsConfirmed: 1,
    status: 'CONFIRMED',
  },
  {
    name: 'عائلة الدوسري',
    phone: '+966539904471',
    group: NEIGHBOURS,
    companionsAllowed: 4,
    companionsConfirmed: 0,
    status: 'DECLINED',
  },
  {
    name: 'د. سلطان العتيبي',
    phone: '+966550182264',
    group: WORK,
    companionsAllowed: 3,
    companionsConfirmed: 0,
    status: 'SENT',
  },
  {
    name: 'أ. منيرة الشمري',
    phone: '+966562279013',
    group: BRIDE,
    companionsAllowed: 2,
    companionsConfirmed: 0,
    status: 'NOT_SENT',
  },
  {
    name: 'عبدالله بن ماجد',
    phone: '+966596643308',
    group: GROOM,
    companionsAllowed: 1,
    companionsConfirmed: 0,
    status: 'NOT_SENT',
  },
  {
    name: 'هيا بنت طلال',
    phone: '+966548817702',
    group: FRIENDS,
    companionsAllowed: 3,
    companionsConfirmed: 2,
    status: 'ATTENDED',
  },
  {
    name: 'أ. ريم الزهراني',
    phone: '+966551002233',
    group: FRIENDS,
    companionsAllowed: 2,
    companionsConfirmed: 1,
    status: 'CONFIRMED',
  },
  {
    name: 'م. بدر السهلي',
    phone: '+966553441199',
    group: WORK,
    companionsAllowed: 1,
    companionsConfirmed: 0,
    status: 'CONFIRMED',
  },
  {
    name: 'عائلة الغامدي',
    phone: '+966505778341',
    group: NEIGHBOURS,
    companionsAllowed: 5,
    companionsConfirmed: 4,
    status: 'CONFIRMED',
  },
  {
    name: 'أ. خالد بن عمر',
    phone: '+966561209987',
    group: GROOM,
    companionsAllowed: 2,
    companionsConfirmed: 0,
    status: 'DECLINED',
  },
  {
    name: 'لطيفة بنت سعد',
    phone: '+966558830012',
    group: BRIDE,
    companionsAllowed: 3,
    companionsConfirmed: 2,
    status: 'CONFIRMED',
  },
  {
    name: 'د. ماجد الحربي',
    phone: '+966502211764',
    group: WORK,
    companionsAllowed: 1,
    companionsConfirmed: 0,
    status: 'SENT',
  },
  {
    name: 'أ. سارة الحربي',
    phone: '+966547719920',
    group: FRIENDS,
    companionsAllowed: 2,
    companionsConfirmed: 0,
    status: 'SENT',
  },
  {
    name: 'عائلة القرني',
    phone: '+966559003471',
    group: NEIGHBOURS,
    companionsAllowed: 4,
    companionsConfirmed: 3,
    status: 'CONFIRMED',
  },
  {
    name: 'م. تركي الشهري',
    phone: '+966533388201',
    group: GROOM,
    companionsAllowed: 2,
    companionsConfirmed: 1,
    status: 'CONFIRMED',
  },
  {
    name: 'أ. جواهر المطيري',
    phone: '+966566120945',
    group: BRIDE,
    companionsAllowed: 3,
    companionsConfirmed: 0,
    status: 'OPENED',
  },
  {
    name: 'عبدالرحمن بن فهد',
    phone: '+966504467788',
    group: WORK,
    companionsAllowed: 1,
    companionsConfirmed: 1,
    status: 'CONFIRMED',
  },
  {
    name: 'أ. أسماء العنزي',
    phone: '+966557712306',
    group: FRIENDS,
    companionsAllowed: 2,
    companionsConfirmed: 0,
    status: 'NOT_SENT',
  },
  {
    name: 'عائلة البقمي',
    phone: '+966598821140',
    group: BRIDE,
    companionsAllowed: 4,
    companionsConfirmed: 0,
    status: 'NOT_SENT',
  },
];

function displayCode(): string {
  const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** Guests past NOT_SENT have been messaged; the rest have no timestamps yet. */
function invitationTimestamps(status: GuestStatus) {
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

  if (status === 'NOT_SENT') return { sentAt: null, openedAt: null, respondedAt: null };
  if (status === 'SENT') return { sentAt: daysAgo(3), openedAt: null, respondedAt: null };
  if (status === 'OPENED') return { sentAt: daysAgo(2), openedAt: daysAgo(1), respondedAt: null };
  return { sentAt: daysAgo(4), openedAt: daysAgo(4), respondedAt: daysAgo(2) };
}

async function main(): Promise<void> {
  console.log('› seeding catalogue…');

  for (const pkg of PACKAGES) {
    await prisma.package.upsert({
      where: { key: pkg.key },
      update: { ...pkg, featuresAr: [...pkg.featuresAr], featuresEn: [...pkg.featuresEn] },
      create: { ...pkg, featuresAr: [...pkg.featuresAr], featuresEn: [...pkg.featuresEn] },
    });
  }

  for (const tpl of TEMPLATES) {
    await prisma.template.upsert({ where: { key: tpl.key }, update: tpl, create: tpl });
  }

  await prisma.template.updateMany({
    where: { key: { in: RETIRED_TEMPLATE_KEYS } },
    data: { isActive: false },
  });

  console.log('› seeding demo host…');

  const passwordHash = await argonHash(DEMO_HOST_PASSWORD);
  const host = await prisma.user.upsert({
    where: { phone: DEMO_HOST_PHONE },
    update: { name: 'أم عبدالعزيز', passwordHash },
    create: {
      name: 'أم عبدالعزيز',
      phone: DEMO_HOST_PHONE,
      passwordHash,
      role: 'HOST',
      locale: 'ar',
      phoneVerifiedAt: new Date(),
    },
  });

  // A second host with no events — the cross-tenant fixture, and a reminder that
  // "my events" must never mean "all events".
  await prisma.user.upsert({
    where: { phone: '+966500000001' },
    update: {},
    create: {
      name: 'أبو سعد',
      phone: '+966500000001',
      passwordHash: await argonHash(DEMO_HOST_PASSWORD),
      role: 'HOST',
    },
  });

  await prisma.user.upsert({
    where: { phone: '+966500000009' },
    update: { role: 'ADMIN' },
    create: {
      name: 'مشرف النظام',
      phone: '+966500000009',
      passwordHash: await argonHash(DEMO_HOST_PASSWORD),
      role: 'ADMIN',
    },
  });

  console.log('› rebuilding demo event…');

  // Cascades through guests, invitations, rsvps and check-ins.
  await prisma.event.deleteMany({ where: { hostId: host.id } });

  const [eventPackage, classic] = await Promise.all([
    prisma.package.findUniqueOrThrow({ where: { key: 'event-300' } }),
    prisma.template.findUniqueOrThrow({ where: { key: 'classic' } }),
  ]);

  const event = await prisma.event.create({
    data: {
      hostId: host.id,
      title: 'حفل زفاف لمى و عبدالعزيز',
      type: 'WEDDING',
      status: 'ACTIVE',
      sectionMode: 'SINGLE',
      startsAt: new Date('2026-11-20T17:30:00.000Z'), // 20:30 Asia/Riyadh
      endsAt: new Date('2026-11-20T21:00:00.000Z'),
      timezone: 'Asia/Riyadh',
      hostName: 'عبدالعزيز بن سعد',
      partnerName: 'لمى بنت خالد',
      venueName: 'قاعة الماسة للاحتفالات',
      venueAddress: 'طريق الملك عبدالعزيز، الرياض',
      venueLat: 24.7136,
      venueLng: 46.6753,
      templateId: classic.id,
      packageId: eventPackage.id,
      rsvpDeadline: new Date('2026-11-15T20:59:00.000Z'),
      defaultCompanionsAllowed: 2,
      scannerPasswordHash: await argonHash(DEMO_SCANNER_PASSWORD),
    },
  });

  console.log(`› seeding ${GUESTS.length} guests…`);

  for (const guest of GUESTS) {
    const created = await prisma.guest.create({
      data: {
        eventId: event.id,
        name: guest.name,
        phone: guest.phone,
        group: guest.group,
        companionsAllowed: guest.companionsAllowed,
        companionsConfirmed: guest.companionsConfirmed,
        status: guest.status,
      },
    });

    const times = invitationTimestamps(guest.status);

    await prisma.invitation.create({
      data: {
        guestId: created.id,
        eventId: event.id,
        token: nanoid(),
        displayCode: displayCode(),
        ...times,
        qrIssuedAt: times.respondedAt,
      },
    });

    // Keep the RSVP history consistent with the projected status — a CONFIRMED
    // guest with no response row would be a fixture that cannot happen in prod.
    if (guest.status === 'CONFIRMED' || guest.status === 'ATTENDED') {
      await prisma.rsvpResponse.create({
        data: {
          guestId: created.id,
          eventId: event.id,
          attending: true,
          companions: guest.companionsConfirmed,
          respondedAt: times.respondedAt ?? new Date(),
        },
      });
    } else if (guest.status === 'DECLINED') {
      await prisma.rsvpResponse.create({
        data: {
          guestId: created.id,
          eventId: event.id,
          attending: false,
          companions: 0,
          respondedAt: times.respondedAt ?? new Date(),
        },
      });
    }
  }

  // The one guest already through the door, so the scanner and report screens
  // have something real to render.
  const attended = await prisma.guest.findFirstOrThrow({
    where: { eventId: event.id, status: 'ATTENDED' },
  });

  const scanner = await prisma.scanUser.create({
    data: {
      eventId: event.id,
      displayName: 'سعود · بوابة الرجال',
      sessionTokenHash: crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex'),
    },
  });

  await prisma.checkIn.create({
    data: {
      guestId: attended.id,
      eventId: event.id,
      seats: attended.companionsConfirmed + 1,
      scannedById: scanner.id,
      method: 'QR',
    },
  });

  const counts = await prisma.guest.groupBy({
    by: ['status'],
    where: { eventId: event.id },
    _count: true,
  });

  console.log('\n✓ seed complete');
  console.log(`  event    ${event.title} (${event.id})`);
  console.log(`  host     ${DEMO_HOST_PHONE} / ${DEMO_HOST_PASSWORD}`);
  console.log(`  admin    +966500000009 / ${DEMO_HOST_PASSWORD}`);
  console.log(`  scanner  event password: ${DEMO_SCANNER_PASSWORD}`);
  console.log(
    `  guests   ${counts.map((c) => `${c.status}=${c._count}`).join(' ')}  (total ${GUESTS.length})`,
  );
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
