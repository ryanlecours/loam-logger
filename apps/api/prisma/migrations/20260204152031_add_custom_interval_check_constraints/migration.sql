-- CreateTable
CREATE TABLE "public"."BikeServicePreference" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "componentType" "public"."ComponentType" NOT NULL,
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customInterval" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikeServicePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BikeServicePreference_bikeId_idx" ON "public"."BikeServicePreference"("bikeId");

-- CreateIndex
CREATE UNIQUE INDEX "BikeServicePreference_bikeId_componentType_key" ON "public"."BikeServicePreference"("bikeId", "componentType");

-- AddForeignKey
ALTER TABLE "public"."BikeServicePreference" ADD CONSTRAINT "BikeServicePreference_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add CHECK constraints for customInterval (must be between 1 and 1000 hours)
ALTER TABLE "public"."UserServicePreference"
  ADD CONSTRAINT "UserServicePreference_customInterval_check"
  CHECK ("customInterval" IS NULL OR ("customInterval" > 0 AND "customInterval" <= 1000));

ALTER TABLE "public"."BikeServicePreference"
  ADD CONSTRAINT "BikeServicePreference_customInterval_check"
  CHECK ("customInterval" IS NULL OR ("customInterval" > 0 AND "customInterval" <= 1000));
