/*
  Warnings:

  - You are about to drop the `BetaWaitlist` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[bikeId,type,location]` on the table `Component` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."ComponentLocation" AS ENUM ('FRONT', 'REAR', 'NONE');

-- CreateEnum
CREATE TYPE "public"."AcquisitionCondition" AS ENUM ('NEW', 'USED', 'MIXED');

-- CreateEnum
CREATE TYPE "public"."BaselineMethod" AS ENUM ('DEFAULT', 'SLIDER', 'DATES');

-- CreateEnum
CREATE TYPE "public"."BaselineConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."EmailType" AS ENUM ('activation', 'welcome_series', 'announcement', 'custom');

-- CreateEnum
CREATE TYPE "public"."TriggerSource" AS ENUM ('admin_manual', 'system_activation', 'system_welcome_series', 'scheduled');

-- CreateEnum
CREATE TYPE "public"."EmailStatus" AS ENUM ('sent', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "public"."ScheduledEmailStatus" AS ENUM ('pending', 'processing', 'sent', 'cancelled', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ComponentType" ADD VALUE 'STEM';
ALTER TYPE "public"."ComponentType" ADD VALUE 'HANDLEBAR';
ALTER TYPE "public"."ComponentType" ADD VALUE 'SADDLE';
ALTER TYPE "public"."ComponentType" ADD VALUE 'SEATPOST';
ALTER TYPE "public"."ComponentType" ADD VALUE 'RIMS';
ALTER TYPE "public"."ComponentType" ADD VALUE 'CRANK';
ALTER TYPE "public"."ComponentType" ADD VALUE 'REAR_DERAILLEUR';
ALTER TYPE "public"."ComponentType" ADD VALUE 'BRAKE_PAD';
ALTER TYPE "public"."ComponentType" ADD VALUE 'BRAKE_ROTOR';
ALTER TYPE "public"."ComponentType" ADD VALUE 'HEADSET';
ALTER TYPE "public"."ComponentType" ADD VALUE 'BOTTOM_BRACKET';

-- AlterEnum
ALTER TYPE "public"."UserRole" ADD VALUE 'FOUNDING_RIDERS';

-- DropForeignKey
ALTER TABLE "public"."Bike" DROP CONSTRAINT "Bike_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OauthToken" DROP CONSTRAINT "OauthToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Ride" DROP CONSTRAINT "Ride_userId_fkey";

-- AlterTable
ALTER TABLE "public"."Bike" ADD COLUMN     "acquisitionCondition" "public"."AcquisitionCondition",
ADD COLUMN     "batteryWh" INTEGER,
ADD COLUMN     "buildKind" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "family" TEXT,
ADD COLUMN     "frameMaterial" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "hangerStandard" TEXT,
ADD COLUMN     "isEbike" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFrameset" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motorMaker" TEXT,
ADD COLUMN     "motorModel" TEXT,
ADD COLUMN     "motorPowerW" INTEGER,
ADD COLUMN     "motorTorqueNm" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "spokesUrl" TEXT,
ADD COLUMN     "subcategory" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Component" ADD COLUMN     "baselineConfidence" "public"."BaselineConfidence" NOT NULL DEFAULT 'HIGH',
ADD COLUMN     "baselineMethod" "public"."BaselineMethod" NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN     "baselineSetAt" TIMESTAMP(3),
ADD COLUMN     "baselineWearPercent" INTEGER DEFAULT 0,
ADD COLUMN     "lastServicedAt" TIMESTAMP(3),
ADD COLUMN     "location" "public"."ComponentLocation" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "emailUnsubscribed" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "public"."BetaWaitlist";

-- CreateTable
CREATE TABLE "public"."ServiceLog" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "hoursAtService" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailType" "public"."EmailType" NOT NULL,
    "toEmail" TEXT NOT NULL,
    "templateVersion" TEXT,
    "triggerSource" "public"."TriggerSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,
    "status" "public"."EmailStatus" NOT NULL,
    "failureReason" TEXT,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScheduledEmail" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "messageHtml" TEXT NOT NULL,
    "templateType" TEXT NOT NULL DEFAULT 'announcement',
    "recipientIds" TEXT[],
    "recipientCount" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "public"."ScheduledEmailStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "sentCount" INTEGER,
    "failedCount" INTEGER,
    "suppressedCount" INTEGER,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ScheduledEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceLog_componentId_idx" ON "public"."ServiceLog"("componentId");

-- CreateIndex
CREATE INDEX "ServiceLog_performedAt_idx" ON "public"."ServiceLog"("performedAt");

-- CreateIndex
CREATE INDEX "EmailSend_userId_idx" ON "public"."EmailSend"("userId");

-- CreateIndex
CREATE INDEX "EmailSend_createdAt_idx" ON "public"."EmailSend"("createdAt");

-- CreateIndex
CREATE INDEX "EmailSend_triggerSource_idx" ON "public"."EmailSend"("triggerSource");

-- CreateIndex
CREATE INDEX "ScheduledEmail_status_idx" ON "public"."ScheduledEmail"("status");

-- CreateIndex
CREATE INDEX "ScheduledEmail_scheduledFor_idx" ON "public"."ScheduledEmail"("scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledEmail_createdBy_idx" ON "public"."ScheduledEmail"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "Component_bikeId_type_location_key" ON "public"."Component"("bikeId", "type", "location");

-- AddForeignKey
ALTER TABLE "public"."OauthToken" ADD CONSTRAINT "OauthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ride" ADD CONSTRAINT "Ride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bike" ADD CONSTRAINT "Bike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceLog" ADD CONSTRAINT "ServiceLog_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "public"."Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailSend" ADD CONSTRAINT "EmailSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
