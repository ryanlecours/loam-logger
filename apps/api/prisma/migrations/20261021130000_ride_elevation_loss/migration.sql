-- Total descent per ride. Nullable on purpose: NULL means no source reported
-- one, which is every existing row. Zero is reserved for a genuinely flat ride.
ALTER TABLE "Ride" ADD COLUMN "elevationLossMeters" DOUBLE PRECISION;
