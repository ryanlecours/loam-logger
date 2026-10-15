-- Lets the owner opt a component share link into listing each ride in its
-- window. Existing links default to off, so none of them starts showing rides
-- without the owner asking. Additive only.
ALTER TABLE "ComponentShare" ADD COLUMN "includeRides" BOOLEAN NOT NULL DEFAULT false;
