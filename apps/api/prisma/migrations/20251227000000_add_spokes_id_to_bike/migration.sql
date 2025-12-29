-- AlterTable
ALTER TABLE "Bike" ADD COLUMN "spokesId" TEXT;

-- CreateIndex
CREATE INDEX "Bike_spokesId_idx" ON "Bike"("spokesId");
