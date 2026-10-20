-- Sign-in grants for email verification: the client that proved the password
-- holds a secret it can trade for a session once the email is verified. New
-- table only; nothing existing changes.

-- CreateTable
CREATE TABLE "EmailSignInGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "sessionTokenVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSignInGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSignInGrant_secretHash_key" ON "EmailSignInGrant"("secretHash");

-- CreateIndex
CREATE INDEX "EmailSignInGrant_userId_idx" ON "EmailSignInGrant"("userId");

-- CreateIndex
CREATE INDEX "EmailSignInGrant_expiresAt_idx" ON "EmailSignInGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailSignInGrant" ADD CONSTRAINT "EmailSignInGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
