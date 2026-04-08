-- CreateEnum
CREATE TYPE "SubscriptionProvider" AS ENUM ('STRIPE', 'APPLE', 'GOOGLE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "subscriptionProvider" "SubscriptionProvider",
ADD COLUMN "revenuecatAppUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_revenuecatAppUserId_key" ON "User"("revenuecatAppUserId");
