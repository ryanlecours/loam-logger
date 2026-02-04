-- CreateTable
CREATE TABLE "public"."UserServicePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "componentType" "public"."ComponentType" NOT NULL,
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customInterval" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserServicePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserServicePreference_userId_idx" ON "public"."UserServicePreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserServicePreference_userId_componentType_key" ON "public"."UserServicePreference"("userId", "componentType");

-- AddForeignKey
ALTER TABLE "public"."UserServicePreference" ADD CONSTRAINT "UserServicePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
