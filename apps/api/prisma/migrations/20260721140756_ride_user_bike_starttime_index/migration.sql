-- CreateIndex
CREATE INDEX "Ride_userId_bikeId_startTime_idx" ON "Ride"("userId", "bikeId", "startTime");
