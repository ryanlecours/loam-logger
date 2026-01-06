-- CreateIndex
CREATE INDEX "EmailSend_userId_createdAt_idx" ON "public"."EmailSend"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSend_status_createdAt_idx" ON "public"."EmailSend"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSend_emailType_triggerSource_idx" ON "public"."EmailSend"("emailType", "triggerSource");
