-- Parts and cost in the logbook. Every column is nullable and the new table
-- starts empty, so existing rows read as "not recorded" (never zero) and the
-- migration is additive on staging and production alike. Amounts are integer
-- minor units (cents) with an ISO 4217 code beside them; sums never cross
-- currencies.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currency" VARCHAR(3);

-- AlterTable
ALTER TABLE "Bike" ADD COLUMN     "purchaseCurrency" VARCHAR(3),
ADD COLUMN     "purchasePriceMinor" INTEGER;

-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "purchaseCurrency" VARCHAR(3),
ADD COLUMN     "purchasePriceMinor" INTEGER,
ADD COLUMN     "purchasedFrom" TEXT;

-- AlterTable
ALTER TABLE "ServiceLog" ADD COLUMN     "costMinor" INTEGER,
ADD COLUMN     "currency" VARCHAR(3);

-- CreateTable
CREATE TABLE "ServicePart" (
    "id" TEXT NOT NULL,
    "serviceLogId" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "priceMinor" INTEGER,
    "vendor" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServicePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePart_serviceLogId_idx" ON "ServicePart"("serviceLogId");

-- AddForeignKey
ALTER TABLE "ServicePart" ADD CONSTRAINT "ServicePart_serviceLogId_fkey" FOREIGN KEY ("serviceLogId") REFERENCES "ServiceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
