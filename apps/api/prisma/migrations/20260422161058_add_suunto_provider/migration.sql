/*
  Warnings:

  - A unique constraint covering the columns `[suuntoWorkoutId]` on the table `Ride` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[suuntoUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'suunto';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'SUUNTO';

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "suuntoWorkoutId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suuntoUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ride_suuntoWorkoutId_key" ON "Ride"("suuntoWorkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "User_suuntoUserId_key" ON "User"("suuntoUserId");
