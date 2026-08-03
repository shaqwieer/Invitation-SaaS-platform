-- CreateEnum
CREATE TYPE "CardDesignMode" AS ENUM ('TEMPLATE', 'CUSTOM_REQUEST', 'UPLOAD');

-- CreateEnum
CREATE TYPE "DesignRequestStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cardDesignMode" "CardDesignMode" NOT NULL DEFAULT 'TEMPLATE';

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "customDesignPriceHalalas" INTEGER NOT NULL DEFAULT 19900;

-- CreateTable
CREATE TABLE "CustomDesignRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "DesignRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "contactPhone" TEXT NOT NULL,
    "priceHalalas" INTEGER,
    "adminNotes" TEXT,
    "billedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDesignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomDesignRequest_eventId_createdAt_idx" ON "CustomDesignRequest"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomDesignRequest_status_createdAt_idx" ON "CustomDesignRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomDesignRequest" ADD CONSTRAINT "CustomDesignRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
