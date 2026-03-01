-- CreateEnum
CREATE TYPE "public"."IntegrationProvider" AS ENUM ('GARMIN', 'STRAVA', 'WHOOP');

-- CreateEnum
CREATE TYPE "public"."OAuthPlatform" AS ENUM ('WEB', 'MOBILE');

-- AlterEnum
ALTER TYPE "public"."TriggerSource" ADD VALUE 'user_action';

-- CreateTable
CREATE TABLE "public"."OAuthAttempt" (
    "id" TEXT NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "public"."OAuthPlatform" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."IntegrationProvider" NOT NULL,
    "externalUserId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OAuthAttempt_stateHash_idx" ON "public"."OAuthAttempt"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthAttempt_userId_provider_createdAt_idx" ON "public"."OAuthAttempt"("userId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "UserIntegration_userId_idx" ON "public"."UserIntegration"("userId");

-- CreateIndex
CREATE INDEX "UserIntegration_provider_externalUserId_idx" ON "public"."UserIntegration"("provider", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegration_userId_provider_key" ON "public"."UserIntegration"("userId", "provider");

-- AddForeignKey
ALTER TABLE "public"."OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserIntegration" ADD CONSTRAINT "UserIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
