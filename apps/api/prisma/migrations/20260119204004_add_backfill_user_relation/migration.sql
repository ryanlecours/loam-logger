-- AddForeignKey
ALTER TABLE "public"."BackfillRequest" ADD CONSTRAINT "BackfillRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
