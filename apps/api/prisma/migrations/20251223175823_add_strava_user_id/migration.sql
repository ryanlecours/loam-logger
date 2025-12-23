/*
  Warnings:

  - A unique constraint covering the columns `[stravaActivityId]` on the table `Ride` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stravaUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "public"."AuthProvider" ADD VALUE 'strava';

-- AlterTable
ALTER TABLE "public"."Ride" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stravaActivityId" TEXT,
ADD COLUMN     "stravaGearId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "activeDataSource" "public"."AuthProvider",
ADD COLUMN     "stravaUserId" TEXT;

-- CreateTable
CREATE TABLE "public"."StravaGearMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaGearId" TEXT NOT NULL,
    "stravaGearName" TEXT,
    "bikeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaGearMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BetaWaitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StravaGearMapping_userId_idx" ON "public"."StravaGearMapping"("userId");

-- CreateIndex
CREATE INDEX "StravaGearMapping_bikeId_idx" ON "public"."StravaGearMapping"("bikeId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaGearMapping_userId_stravaGearId_key" ON "public"."StravaGearMapping"("userId", "stravaGearId");

-- CreateIndex
CREATE UNIQUE INDEX "BetaWaitlist_email_key" ON "public"."BetaWaitlist"("email");

-- CreateIndex
CREATE INDEX "BetaWaitlist_createdAt_idx" ON "public"."BetaWaitlist"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ride_stravaActivityId_key" ON "public"."Ride"("stravaActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stravaUserId_key" ON "public"."User"("stravaUserId");

-- AddForeignKey
ALTER TABLE "public"."Ride" ADD CONSTRAINT "Ride_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "public"."Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StravaGearMapping" ADD CONSTRAINT "StravaGearMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StravaGearMapping" ADD CONSTRAINT "StravaGearMapping_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;
