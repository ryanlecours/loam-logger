-- Device attestation verdict recorded on mobile password signups.
-- Nullable with no default: existing accounts, web signups and Google/Apple
-- signups keep null.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signupAttestation" TEXT;
