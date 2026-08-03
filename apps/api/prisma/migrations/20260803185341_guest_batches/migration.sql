-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "batchId" TEXT,
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GuestBatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "delegateName" TEXT NOT NULL,
    "delegatePhone" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestBatch_token_key" ON "GuestBatch"("token");

-- CreateIndex
CREATE INDEX "GuestBatch_eventId_createdAt_idx" ON "GuestBatch"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Guest_batchId_idx" ON "Guest"("batchId");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "GuestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestBatch" ADD CONSTRAINT "GuestBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
