/*
  Warnings:

  - You are about to drop the column `distanceMeters` on the `Ride` table. All the data in the column will be lost.
  - You are about to drop the column `elevationGainMeters` on the `Ride` table. All the data in the column will be lost.
  - Added the required column `distanceMiles` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `elevationGainFeet` to the `Ride` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Ride" DROP COLUMN "distanceMeters",
DROP COLUMN "elevationGainMeters",
ADD COLUMN     "distanceMiles" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "elevationGainFeet" DOUBLE PRECISION NOT NULL;
