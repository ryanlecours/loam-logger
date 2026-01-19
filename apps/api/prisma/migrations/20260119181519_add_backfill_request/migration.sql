-- CreateEnum
CREATE TYPE "public"."BackfillStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."BackfillRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "public"."AuthProvider" NOT NULL,
    "year" TEXT NOT NULL,
    "status" "public"."BackfillStatus" NOT NULL DEFAULT 'pending',
    "ridesFound" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BackfillRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillRequest_userId_idx" ON "public"."BackfillRequest"("userId");

-- CreateIndex
CREATE INDEX "BackfillRequest_userId_provider_idx" ON "public"."BackfillRequest"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillRequest_userId_provider_year_key" ON "public"."BackfillRequest"("userId", "provider", "year");
