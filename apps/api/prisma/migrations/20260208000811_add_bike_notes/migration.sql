-- CreateEnum
CREATE TYPE "public"."BikeNoteType" AS ENUM ('MANUAL', 'SWAP');

-- CreateTable
CREATE TABLE "public"."BikeNote" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "noteType" "public"."BikeNoteType" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB,
    "snapshotBefore" JSONB,
    "snapshotAfter" JSONB,
    "installEventId" TEXT,

    CONSTRAINT "BikeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BikeNote_installEventId_key" ON "public"."BikeNote"("installEventId");

-- CreateIndex
CREATE INDEX "BikeNote_bikeId_idx" ON "public"."BikeNote"("bikeId");

-- CreateIndex
CREATE INDEX "BikeNote_userId_idx" ON "public"."BikeNote"("userId");

-- CreateIndex
CREATE INDEX "BikeNote_bikeId_createdAt_idx" ON "public"."BikeNote"("bikeId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."BikeNote" ADD CONSTRAINT "BikeNote_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BikeNote" ADD CONSTRAINT "BikeNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BikeNote" ADD CONSTRAINT "BikeNote_installEventId_fkey" FOREIGN KEY ("installEventId") REFERENCES "public"."BikeComponentInstall"("id") ON DELETE SET NULL ON UPDATE CASCADE;
