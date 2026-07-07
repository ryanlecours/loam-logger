-- Public share slug for the read-only bike-history page.
ALTER TABLE "Bike" ADD COLUMN "shareSlug" TEXT;

CREATE UNIQUE INDEX "Bike_shareSlug_key" ON "Bike"("shareSlug");
