-- CreateEnum
CREATE TYPE "ServiceNotificationMode" AS ENUM ('RIDES_BEFORE', 'HOURS_BEFORE', 'AT_SERVICE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RIDE_UPLOADED', 'SERVICE_DUE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expoPushToken" TEXT,
ADD COLUMN     "notifyOnRideUpload" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "BikeNotificationPreference" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "serviceNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serviceNotificationMode" "ServiceNotificationMode" NOT NULL DEFAULT 'RIDES_BEFORE',
    "serviceNotificationThreshold" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikeNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bikeId" TEXT,
    "componentId" TEXT,
    "notificationType" "NotificationType" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BikeNotificationPreference_bikeId_key" ON "BikeNotificationPreference"("bikeId");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_idx" ON "NotificationLog"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_componentId_notificationType_idx" ON "NotificationLog"("componentId", "notificationType");

-- AddForeignKey
ALTER TABLE "BikeNotificationPreference" ADD CONSTRAINT "BikeNotificationPreference_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: Create default BikeNotificationPreference for all existing bikes
INSERT INTO "BikeNotificationPreference" ("id", "bikeId", "serviceNotificationsEnabled", "serviceNotificationMode", "serviceNotificationThreshold", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", true, 'RIDES_BEFORE', 3, NOW(), NOW()
FROM "Bike"
ON CONFLICT ("bikeId") DO NOTHING;
