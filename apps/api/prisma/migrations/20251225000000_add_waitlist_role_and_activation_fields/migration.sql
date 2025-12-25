-- Add WAITLIST to UserRole enum
ALTER TYPE "UserRole" ADD VALUE 'WAITLIST' BEFORE 'FREE';

-- Add activation fields to User table
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "activatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "activatedBy" TEXT;
