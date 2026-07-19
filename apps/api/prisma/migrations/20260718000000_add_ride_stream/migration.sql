-- Raw per-point activity streams (Strava first). One row per ride; parallel
-- index-aligned arrays in "data". Retained so lift detection can re-run
-- without re-hitting provider APIs. Deleted explicitly on Strava disconnect
-- (rides survive); ride deletion cascades.
CREATE TABLE "RideStream" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideStream_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RideStream_rideId_key" ON "RideStream"("rideId");

ALTER TABLE "RideStream" ADD CONSTRAINT "RideStream_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
