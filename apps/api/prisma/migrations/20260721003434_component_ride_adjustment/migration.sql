-- CreateEnum
CREATE TYPE "ComponentRideAdjustmentKind" AS ENUM ('EXCLUDE', 'INCLUDE');

-- CreateTable
CREATE TABLE "ComponentRideAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "kind" "ComponentRideAdjustmentKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentRideAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComponentRideAdjustment_rideId_idx" ON "ComponentRideAdjustment"("rideId");

-- CreateIndex
CREATE INDEX "ComponentRideAdjustment_userId_idx" ON "ComponentRideAdjustment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentRideAdjustment_componentId_rideId_key" ON "ComponentRideAdjustment"("componentId", "rideId");

-- AddForeignKey
ALTER TABLE "ComponentRideAdjustment" ADD CONSTRAINT "ComponentRideAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentRideAdjustment" ADD CONSTRAINT "ComponentRideAdjustment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentRideAdjustment" ADD CONSTRAINT "ComponentRideAdjustment_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
