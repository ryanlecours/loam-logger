-- Partial index to accelerate the Query.ridesMissingWeather COUNT(*).
--
-- The query shape is:
--   SELECT COUNT(*) FROM "Ride" r
--   LEFT JOIN "RideWeather" w ON w."rideId" = r.id
--   WHERE r."userId" = $1
--     AND r."startLat" IS NOT NULL
--     AND r."startLng" IS NOT NULL
--     AND w.id IS NULL;
--
-- Without this index, every Settings page mount for a user with thousands of
-- rides scans all of that user's rows to test the coord + weather-null
-- predicate. Postgres can satisfy the filter entirely from this partial
-- index plus a lookup against RideWeather's existing `rideId` unique index.
--
-- Partial predicate mirrors the resolver:
--   only index rides that COULD have weather (have coords). Rides without
--   coords are excluded from the count entirely, so they don't belong here.
CREATE INDEX "Ride_missing_weather_idx"
  ON "Ride" ("userId")
  WHERE "startLat" IS NOT NULL AND "startLng" IS NOT NULL;
