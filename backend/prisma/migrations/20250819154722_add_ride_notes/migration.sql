-- AlterTable
ALTER TABLE "public"."Ride" ADD COLUMN     "notes" TEXT,
ALTER COLUMN "garminActivityId" DROP NOT NULL;
