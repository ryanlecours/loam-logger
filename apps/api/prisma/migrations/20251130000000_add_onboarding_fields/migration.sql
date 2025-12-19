-- AlterTable
ALTER TABLE "User" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "location" TEXT,
ADD COLUMN "age" INTEGER;
