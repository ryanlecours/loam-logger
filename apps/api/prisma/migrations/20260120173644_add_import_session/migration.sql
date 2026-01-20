-- CreateEnum
CREATE TYPE "public"."ImportSessionStatus" AS ENUM ('running', 'completed');

-- AlterTable
ALTER TABLE "public"."Ride" ADD COLUMN     "importSessionId" TEXT;

-- CreateTable
CREATE TABLE "public"."ImportSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "status" "public"."ImportSessionStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityReceivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "unassignedRideCount" INTEGER NOT NULL DEFAULT 0,
    "userAcknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportSession_userId_idx" ON "public"."ImportSession"("userId");

-- CreateIndex
CREATE INDEX "ImportSession_userId_provider_status_idx" ON "public"."ImportSession"("userId", "provider", "status");

-- CreateIndex
CREATE INDEX "ImportSession_status_lastActivityReceivedAt_idx" ON "public"."ImportSession"("status", "lastActivityReceivedAt");

-- CreateIndex
CREATE INDEX "Ride_importSessionId_idx" ON "public"."Ride"("importSessionId");

-- AddForeignKey
ALTER TABLE "public"."Ride" ADD CONSTRAINT "Ride_importSessionId_fkey" FOREIGN KEY ("importSessionId") REFERENCES "public"."ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportSession" ADD CONSTRAINT "ImportSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
