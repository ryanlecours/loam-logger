/*
  Warnings:

  - A unique constraint covering the columns `[replacedById]` on the table `Component` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Component" ADD COLUMN     "pairGroupId" TEXT,
ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "pairedComponentMigrationSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Component_replacedById_key" ON "public"."Component"("replacedById");

-- CreateIndex
CREATE INDEX "Component_pairGroupId_idx" ON "public"."Component"("pairGroupId");

-- AddForeignKey
ALTER TABLE "public"."Component" ADD CONSTRAINT "Component_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "public"."Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;
