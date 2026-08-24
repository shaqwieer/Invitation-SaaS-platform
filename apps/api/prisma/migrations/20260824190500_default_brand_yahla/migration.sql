-- The shipped brand identity, for deployments created from here on.
--
-- Defaults only. The existing singleton row is deliberately left alone: an
-- operator who has set their own name in Admin → Branding must not have it
-- rewritten by a deploy, and on the live boxes that row is the source of truth
-- for what the site calls itself.
ALTER TABLE "PlatformSettings" ALTER COLUMN "brandNameAr" SET DEFAULT 'يا هلا';
ALTER TABLE "PlatformSettings" ALTER COLUMN "brandNameEn" SET DEFAULT 'Yahla';
ALTER TABLE "PlatformSettings" ALTER COLUMN "logoMark" SET DEFAULT 'ي';
