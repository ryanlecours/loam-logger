-- CreateEnum
CREATE TYPE "ComponentStatus" AS ENUM ('INVENTORY', 'INSTALLED', 'RETIRED');

-- AlterTable: Add status column to Component
ALTER TABLE "Component" ADD COLUMN "status" "ComponentStatus" NOT NULL DEFAULT 'INSTALLED';

-- Backfill status from existing data
UPDATE "Component" SET "status" = 'RETIRED' WHERE "retiredAt" IS NOT NULL;
UPDATE "Component" SET "status" = 'INVENTORY' WHERE "bikeId" IS NULL AND "retiredAt" IS NULL;

-- CreateTable: BikeComponentInstall
CREATE TABLE "BikeComponentInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "BikeComponentInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX "BikeComponentInstall_userId_idx" ON "BikeComponentInstall"("userId");
CREATE INDEX "BikeComponentInstall_bikeId_idx" ON "BikeComponentInstall"("bikeId");
CREATE INDEX "BikeComponentInstall_componentId_idx" ON "BikeComponentInstall"("componentId");
CREATE INDEX "BikeComponentInstall_bikeId_removedAt_idx" ON "BikeComponentInstall"("bikeId", "removedAt");

-- Partial unique index: only one active install per bike/slot
CREATE UNIQUE INDEX "unique_active_install_per_slot"
  ON "BikeComponentInstall" ("bikeId", "slotKey")
  WHERE "removedAt" IS NULL;

-- Partial unique index: a component can only be actively installed once
CREATE UNIQUE INDEX "unique_active_component_install"
  ON "BikeComponentInstall" ("componentId")
  WHERE "removedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "BikeComponentInstall" ADD CONSTRAINT "BikeComponentInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeComponentInstall" ADD CONSTRAINT "BikeComponentInstall_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeComponentInstall" ADD CONSTRAINT "BikeComponentInstall_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Populate install records for all currently-installed components
INSERT INTO "BikeComponentInstall" ("id", "userId", "bikeId", "componentId", "slotKey", "installedAt")
SELECT
  gen_random_uuid(),
  c."userId",
  c."bikeId",
  c."id",
  c."type" || '_' || c."location",
  COALESCE(c."installedAt", c."createdAt")
FROM "Component" c
WHERE c."bikeId" IS NOT NULL
  AND c."retiredAt" IS NULL;
