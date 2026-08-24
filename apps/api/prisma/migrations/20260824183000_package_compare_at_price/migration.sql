-- The «was» price shown struck through beside the real one.
--
-- Nullable with no default on purpose: NULL means "not on offer", and every
-- existing package should stay that way rather than acquiring a 0%-off badge
-- the moment this lands.
ALTER TABLE "Package" ADD COLUMN "compareAtHalalas" INTEGER;
