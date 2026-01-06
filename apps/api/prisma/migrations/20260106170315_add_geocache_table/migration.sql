-- CreateTable
CREATE TABLE "public"."GeoCache" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoCache_lat_lon_idx" ON "public"."GeoCache"("lat", "lon");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCache_lat_lon_key" ON "public"."GeoCache"("lat", "lon");
