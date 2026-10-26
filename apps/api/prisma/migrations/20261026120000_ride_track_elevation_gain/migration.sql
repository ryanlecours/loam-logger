-- Climb summed over the whole stored track, the denominator for the share of
-- a ride's climb a mapped lift did. Nullable: existing rows stay NULL until
-- the lift worker re-runs or scripts/backfill-track-climb.ts fills them, and
-- the API falls back to a plain subtraction for those.
ALTER TABLE "Ride" ADD COLUMN "trackElevationGainMeters" DOUBLE PRECISION;
