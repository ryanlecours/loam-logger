/*
  Warnings:

  - A unique constraint covering the columns `[whoopWorkoutId]` on the table `Ride` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[whoopUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "public"."AuthProvider" ADD VALUE 'whoop';

-- AlterTable
ALTER TABLE "public"."Ride" ADD COLUMN     "whoopWorkoutId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "whoopUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ride_whoopWorkoutId_key" ON "public"."Ride"("whoopWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "User_whoopUserId_key" ON "public"."User"("whoopUserId");
