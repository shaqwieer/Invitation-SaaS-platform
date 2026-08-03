-- Events created before the choice existed get the mode their data implies.
--
-- Without this every existing event lands on the TEMPLATE default, so a host who
-- had already uploaded artwork would open the card editor and be told they were
-- on a template — with their own design still showing to guests, because
-- resolveArtwork puts the upload first. The stored decision and the rendered
-- result would disagree from the first day.
--
-- Same precedence as resolveArtwork: an upload beats a pasted URL beats a
-- template.
UPDATE "Event"
SET "cardDesignMode" = 'UPLOAD'
WHERE "cardImageMime" IS NOT NULL
   OR "customCardUrl" IS NOT NULL;
