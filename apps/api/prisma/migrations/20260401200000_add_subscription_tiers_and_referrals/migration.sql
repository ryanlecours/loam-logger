-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE_LIGHT', 'FREE_FULL', 'PRO');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'COMPLETED');

-- AlterEnum
ALTER TYPE "BikeStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'upgrade_confirmation';
ALTER TYPE "EmailType" ADD VALUE 'downgrade_notice';
ALTER TYPE "EmailType" ADD VALUE 'payment_failed';
ALTER TYPE "EmailType" ADD VALUE 'referral_success';

-- AlterTable: Add subscription fields to User
ALTER TABLE "User" ADD COLUMN "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE_LIGHT';
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "needsDowngradeSelection" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateTable: Referral
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");
CREATE INDEX "Referral_referrerUserId_idx" ON "Referral"("referrerUserId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data Migration: Set subscription tiers for existing users
UPDATE "User" SET "subscriptionTier" = 'FREE_FULL' WHERE "role" = 'FREE';
UPDATE "User" SET "subscriptionTier" = 'PRO' WHERE "role" IN ('PRO', 'ADMIN');
UPDATE "User" SET "subscriptionTier" = 'FREE_LIGHT' WHERE "role" = 'WAITLIST';

-- Data Migration: Generate referral codes for all existing users
UPDATE "User" SET "referralCode" = substr(md5(random()::text), 1, 8) WHERE "referralCode" IS NULL;
