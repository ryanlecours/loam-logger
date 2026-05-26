-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'suunto_integration_live';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trailStewardshipNoticeSeenAt" TIMESTAMP(3);
