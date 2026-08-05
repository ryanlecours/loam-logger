-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "clientMutationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ride_userId_clientMutationId_key" ON "Ride"("userId", "clientMutationId");
