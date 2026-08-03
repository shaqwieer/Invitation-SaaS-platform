-- CreateEnum
CREATE TYPE "DesignRequestKind" AS ENUM ('TEMPLATE_TAILORING', 'CUSTOM');

-- AlterTable
ALTER TABLE "CustomDesignRequest" ADD COLUMN     "kind" "DesignRequestKind" NOT NULL DEFAULT 'CUSTOM';

-- CreateIndex
CREATE INDEX "CustomDesignRequest_kind_status_idx" ON "CustomDesignRequest"("kind", "status");
