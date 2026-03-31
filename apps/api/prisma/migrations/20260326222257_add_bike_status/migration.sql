-- CreateEnum
CREATE TYPE "BikeStatus" AS ENUM ('ACTIVE', 'RETIRED', 'SOLD');

-- AlterTable
ALTER TABLE "Bike" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "status" "BikeStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Bike_userId_status_idx" ON "Bike"("userId", "status");
