-- DropIndex
DROP INDEX "NotificationLog_componentId_notificationType_idx";

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_componentId_notificationType_key" ON "NotificationLog"("userId", "componentId", "notificationType");
