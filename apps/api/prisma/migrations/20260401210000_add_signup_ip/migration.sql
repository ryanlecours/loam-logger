-- AlterTable: Add signup IP for referral abuse detection
ALTER TABLE "User" ADD COLUMN "signupIp" TEXT;
