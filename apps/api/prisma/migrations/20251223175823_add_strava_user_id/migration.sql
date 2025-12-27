-- This migration was applied directly to the database
-- Adding placeholder to maintain migration history

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('WAITLIST', 'FREE', 'PRO', 'ADMIN');

-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'strava';

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stravaActivityId" TEXT,
ADD COLUMN     "stravaGearId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeDataSource" "AuthProvider",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "stravaUserId" TEXT;

-- CreateTable
CREATE TABLE "BetaWaitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaGearMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaGearId" TEXT NOT NULL,
    "stravaGearName" TEXT,
    "bikeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaGearMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ride_stravaActivityId_key" ON "Ride"("stravaActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stravaUserId_key" ON "User"("stravaUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BetaWaitlist_email_key" ON "BetaWaitlist"("email");

-- CreateIndex
CREATE INDEX "BetaWaitlist_createdAt_idx" ON "BetaWaitlist"("createdAt");

-- CreateIndex
CREATE INDEX "StravaGearMapping_userId_idx" ON "StravaGearMapping"("userId");

-- CreateIndex
CREATE INDEX "StravaGearMapping_bikeId_idx" ON "StravaGearMapping"("bikeId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaGearMapping_userId_stravaGearId_key" ON "StravaGearMapping"("userId", "stravaGearId");

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaGearMapping" ADD CONSTRAINT "StravaGearMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaGearMapping" ADD CONSTRAINT "StravaGearMapping_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;
