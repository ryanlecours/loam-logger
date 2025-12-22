/*
  Warnings:

  - Changed the type of `provider` on the `OauthToken` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('garmin', 'google');

-- AlterTable
ALTER TABLE "public"."OauthToken" DROP COLUMN "provider",
ADD COLUMN     "provider" "public"."AuthProvider" NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "emailVerified" TIMESTAMP(3),
ALTER COLUMN "name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."UserAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAccount_userId_idx" ON "public"."UserAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_provider_providerUserId_key" ON "public"."UserAccount"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OauthToken_userId_provider_key" ON "public"."OauthToken"("userId", "provider");

-- AddForeignKey
ALTER TABLE "public"."UserAccount" ADD CONSTRAINT "UserAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
