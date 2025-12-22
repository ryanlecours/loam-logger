-- CreateEnum
CREATE TYPE "public"."RideType" AS ENUM ('TRAIL_RIDE', 'ENDURO', 'CROSS_COUNTRY', 'DIRT_JUMP', 'SHUTTLE', 'DOWNHILL');

-- CreateEnum
CREATE TYPE "public"."ComponentType" AS ENUM ('FORK', 'SHOCK', 'BRAKES', 'DRIVETRAIN', 'TIRES', 'WHEELS', 'DROPPER', 'PEDALS', 'CHAIN', 'CASSETTE', 'OTHER');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "garminUserId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "garminActivityId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "elevationGainMeters" DOUBLE PRECISION NOT NULL,
    "averageHr" INTEGER,
    "rideType" "public"."RideType" NOT NULL,
    "bikeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "travelForkMm" INTEGER,
    "travelShockMm" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Component" (
    "id" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "type" "public"."ComponentType" NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "hoursUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceDueAtHours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_garminUserId_key" ON "public"."User"("garminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Ride_garminActivityId_key" ON "public"."Ride"("garminActivityId");

-- AddForeignKey
ALTER TABLE "public"."Ride" ADD CONSTRAINT "Ride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ride" ADD CONSTRAINT "Ride_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Bike" ADD CONSTRAINT "Bike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Component" ADD CONSTRAINT "Component_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "public"."Bike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
