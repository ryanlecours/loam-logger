-- CreateEnum
CREATE TYPE "WeatherCondition" AS ENUM ('SUNNY', 'CLOUDY', 'RAINY', 'SNOWY', 'WINDY', 'FOGGY', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN "startLat" DOUBLE PRECISION,
                   ADD COLUMN "startLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RideWeather" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "feelsLikeC" DOUBLE PRECISION,
    "precipitationMm" DOUBLE PRECISION NOT NULL,
    "windSpeedKph" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION,
    "wmoCode" INTEGER NOT NULL,
    "condition" "WeatherCondition" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB,

    CONSTRAINT "RideWeather_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RideWeather_rideId_key" ON "RideWeather"("rideId");

-- CreateIndex
CREATE INDEX "RideWeather_condition_idx" ON "RideWeather"("condition");

-- AddForeignKey
ALTER TABLE "RideWeather" ADD CONSTRAINT "RideWeather_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WeatherCache" (
    "id" TEXT NOT NULL,
    "latKey" DOUBLE PRECISION NOT NULL,
    "lngKey" DOUBLE PRECISION NOT NULL,
    "hourUtc" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherCache_latKey_lngKey_hourUtc_key" ON "WeatherCache"("latKey", "lngKey", "hourUtc");
