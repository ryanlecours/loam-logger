-- Email verification for password signups, plus signup forensics.
--
-- emailVerificationRequired defaults to false, so every existing account
-- (including the password accounts that never verified, which is all of them:
-- nothing sent a verification email before this) keeps signing in exactly as
-- before. Only password signups made after this ships set it to true.
--
-- emailCanonical is backfilled below with the same folding as
-- canonicalizeEmail in apps/api/src/auth/utils.ts: lowercase, drop a +tag on
-- any domain (when the + is not the first character), map googlemail.com to
-- gmail.com, and drop dots in the Gmail local part. A local part that folds to
-- nothing keeps the plain lowercased address. It is indexed but not unique:
-- existing accounts may already collide, and only new signups are refused.

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'email_verification';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCanonical" TEXT,
ADD COLUMN     "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signupIp" TEXT,
ADD COLUMN     "signupUserAgent" TEXT;

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "User_emailCanonical_idx" ON "User"("emailCanonical");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill emailCanonical
WITH parts AS (
  SELECT
    id,
    lower(trim(email)) AS e,
    substring(lower(trim(email)) from '^(.*)@[^@]*$') AS local_part,
    substring(lower(trim(email)) from '@([^@]*)$') AS domain_part
  FROM "User"
),
untagged AS (
  SELECT
    id,
    e,
    CASE WHEN domain_part = 'googlemail.com' THEN 'gmail.com' ELSE domain_part END AS domain_part,
    CASE
      WHEN position('+' in local_part) > 1
        THEN substring(local_part from 1 for position('+' in local_part) - 1)
      ELSE local_part
    END AS local_part
  FROM parts
  WHERE local_part IS NOT NULL AND domain_part IS NOT NULL
),
folded AS (
  SELECT
    id,
    e,
    domain_part,
    CASE WHEN domain_part = 'gmail.com' THEN replace(local_part, '.', '') ELSE local_part END AS local_part
  FROM untagged
)
UPDATE "User" u
SET "emailCanonical" = CASE WHEN f.local_part = '' THEN f.e ELSE f.local_part || '@' || f.domain_part END
FROM folded f
WHERE u.id = f.id;
