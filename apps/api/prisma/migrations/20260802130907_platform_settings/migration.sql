-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "brandNameAr" TEXT NOT NULL DEFAULT 'دعوة',
    "brandNameEn" TEXT NOT NULL DEFAULT 'Da3wa',
    "taglineAr" TEXT NOT NULL DEFAULT 'منصة سعودية للدعوات الرقمية وإدارة حضور المناسبات.',
    "taglineEn" TEXT NOT NULL DEFAULT 'A Saudi platform for digital invitations and event attendance.',
    "logoMark" TEXT NOT NULL DEFAULT 'د',
    "logoData" BYTEA,
    "logoMime" TEXT,
    "logoVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
