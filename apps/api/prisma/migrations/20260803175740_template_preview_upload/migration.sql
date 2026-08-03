-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "previewImageData" BYTEA,
ADD COLUMN     "previewImageMime" TEXT,
ADD COLUMN     "previewImageVersion" INTEGER NOT NULL DEFAULT 0;
