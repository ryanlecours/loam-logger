-- RenameColumns: safe rename + data conversion (no data loss)
-- 1. Rename columns
ALTER TABLE "Ride" RENAME COLUMN "distanceMiles" TO "distanceMeters";
ALTER TABLE "Ride" RENAME COLUMN "elevationGainFeet" TO "elevationGainMeters";

-- 2. Convert existing data: miles -> meters, feet -> meters
UPDATE "Ride" SET "distanceMeters" = "distanceMeters" * 1609.344;
UPDATE "Ride" SET "elevationGainMeters" = "elevationGainMeters" * 0.3048;
