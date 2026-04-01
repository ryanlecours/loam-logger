-- CreateIndex
CREATE INDEX "NotificationLog_componentId_idx" ON "NotificationLog"("componentId");

-- CreateIndex
CREATE INDEX "NotificationLog_bikeId_idx" ON "NotificationLog"("bikeId");

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
