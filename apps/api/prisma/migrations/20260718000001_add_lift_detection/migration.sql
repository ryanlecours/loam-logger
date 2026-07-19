-- Lift detection, shadow mode (docs/plans/lift-detection-plan.md §2).
-- Detected segments index into the immutable RideStream arrays; Ride gains
-- nullable lift-delta columns (NULL = never analyzed, 0 = analyzed, no lift).
-- Raw provider metrics are never mutated.

CREATE TYPE "RideSegmentKind" AS ENUM ('LIFT');

CREATE TABLE "RideSegment" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "kind" "RideSegmentKind" NOT NULL,
    "startIndex" INTEGER NOT NULL,
    "endIndex" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "geometryScore" DOUBLE PRECISION,
    "kinematicScore" DOUBLE PRECISION NOT NULL,
    "liftName" TEXT,
    "liftOsmId" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "elevationGainMeters" DOUBLE PRECISION NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "detectorVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RideSegment_rideId_idx" ON "RideSegment"("rideId");

ALTER TABLE "RideSegment" ADD CONSTRAINT "RideSegment_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OverpassCache" (
    "id" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "isEmpty" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverpassCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OverpassCache_cellKey_key" ON "OverpassCache"("cellKey");

ALTER TABLE "Ride"
  ADD COLUMN "liftDurationSeconds" INTEGER,
  ADD COLUMN "liftElevationGainMeters" DOUBLE PRECISION,
  ADD COLUMN "liftDistanceMeters" DOUBLE PRECISION,
  ADD COLUMN "liftDetectorVersion" INTEGER;
