-- If a default exists, drop it first (enum-typed defaults block type change)
ALTER TABLE "Ride" ALTER COLUMN "rideType" DROP DEFAULT;

-- Change column type from enum to text (preserving values)
ALTER TABLE "Ride"
  ALTER COLUMN "rideType" TYPE TEXT
  USING "rideType"::text;

-- If you prefer VARCHAR(32) instead of TEXT, use this instead:
-- ALTER TABLE "Ride"
--   ALTER COLUMN "rideType" TYPE VARCHAR(32)
--   USING "rideType"::text;

-- OPTIONAL: drop the old enum type if nothing else uses it
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RideType') THEN
    DROP TYPE "RideType";
  END IF;
END $$;
