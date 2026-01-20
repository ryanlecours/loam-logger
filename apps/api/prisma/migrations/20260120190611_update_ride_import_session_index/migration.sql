-- DropIndex
DROP INDEX "public"."Ride_importSessionId_idx";

-- CreateIndex
CREATE INDEX "Ride_importSessionId_bikeId_idx" ON "public"."Ride"("importSessionId", "bikeId");
