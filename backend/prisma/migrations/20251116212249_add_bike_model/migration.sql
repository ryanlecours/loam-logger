/*
  Warnings:

  - Added the required column `userId` to the `Component` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "public"."ComponentType" ADD VALUE 'PIVOT_BEARINGS';

-- DropForeignKey
ALTER TABLE "public"."Component" DROP CONSTRAINT "Component_bikeId_fkey";

-- AlterTable
ALTER TABLE "public"."Bike" ADD COLUMN     "year" INTEGER,
ALTER COLUMN "nickname" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Component" ADD COLUMN     "isStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "bikeId" DROP NOT NULL,
ALTER COLUMN "installedAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Component_userId_idx" ON "public"."Component"("userId");

-- CreateIndex
CREATE INDEX "Component_bikeId_idx" ON "public"."Component"("bikeId");

-- AddForeignKey
ALTER TABLE "public"."Component" ADD CONSTRAINT "Component_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Component" ADD CONSTRAINT "Component_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE SET NULL ON UPDATE CASCADE;
