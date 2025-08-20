/*
  Warnings:

  - You are about to drop the column `notes` on the `Bike` table. All the data in the column will be lost.
  - You are about to drop the column `travelForkMm` on the `Bike` table. All the data in the column will be lost.
  - You are about to drop the column `travelShockMm` on the `Bike` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."BikeComponentType" AS ENUM ('FORK', 'SHOCK', 'WHEELSET', 'DROPPERPOST');

-- AlterTable
ALTER TABLE "public"."Bike" DROP COLUMN "notes",
DROP COLUMN "travelForkMm",
DROP COLUMN "travelShockMm",
ADD COLUMN     "pivotHoursSinceService" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "pivotLastServicedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."BikeComponent" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "type" "public"."BikeComponentType" NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "hoursSinceService" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastServicedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BikeComponent_bikeId_type_key" ON "public"."BikeComponent"("bikeId", "type");

-- AddForeignKey
ALTER TABLE "public"."BikeComponent" ADD CONSTRAINT "BikeComponent_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;
