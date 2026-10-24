-- Worldwide OSM aerialway snapshot for lift detection, loaded by
-- scripts/lift-geometry.ts so ride-time detection does not depend on Overpass.
-- Additive only: no existing table changes.

-- CreateEnum
CREATE TYPE "LiftGeometryImportStatus" AS ENUM ('LOADING', 'ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "LiftGeometryImport" (
    "id" TEXT NOT NULL,
    "status" "LiftGeometryImportStatus" NOT NULL DEFAULT 'LOADING',
    "source" TEXT NOT NULL,
    "osmBaseAt" TIMESTAMP(3),
    "lineCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "LiftGeometryImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiftGeometryLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "osmId" TEXT NOT NULL,
    "name" TEXT,
    "kind" TEXT NOT NULL,
    "coordinates" JSONB NOT NULL,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "minLng" DOUBLE PRECISION NOT NULL,
    "maxLng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LiftGeometryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiftGeometryImport_status_idx" ON "LiftGeometryImport"("status");

-- CreateIndex
CREATE INDEX "LiftGeometryLine_importId_minLat_maxLat_idx" ON "LiftGeometryLine"("importId", "minLat", "maxLat");

-- CreateIndex
CREATE UNIQUE INDEX "LiftGeometryLine_importId_osmId_key" ON "LiftGeometryLine"("importId", "osmId");

-- AddForeignKey
ALTER TABLE "LiftGeometryLine" ADD CONSTRAINT "LiftGeometryLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "LiftGeometryImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

