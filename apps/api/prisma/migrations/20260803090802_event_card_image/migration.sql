-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cardImageData" BYTEA,
ADD COLUMN     "cardImageMime" TEXT,
ADD COLUMN     "cardImageVersion" INTEGER NOT NULL DEFAULT 0;
