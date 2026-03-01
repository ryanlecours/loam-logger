/*
  Warnings:

  - A unique constraint covering the columns `[stateHash]` on the table `OAuthAttempt` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."OAuthAttempt_stateHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAttempt_stateHash_key" ON "public"."OAuthAttempt"("stateHash");
