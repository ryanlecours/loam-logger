-- Migrate BetaWaitlist entries to User table with WAITLIST role
-- Run this BEFORE the 20260105212942_email_scheduling_and_unsubscribe migration
--
-- Usage: psql $DATABASE_URL -f apps/api/prisma/scripts/migrate-beta-waitlist.sql

-- Show counts before migration
SELECT 'Before migration:' as status;
SELECT
  (SELECT COUNT(*) FROM "BetaWaitlist") as beta_waitlist_count,
  (SELECT COUNT(*) FROM "User" WHERE role = 'WAITLIST') as existing_waitlist_users;

-- Insert BetaWaitlist entries into User table
-- Skips emails that already exist in User table
INSERT INTO "User" (id, email, name, role, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  email,
  name,
  'WAITLIST'::"UserRole",
  "createdAt",
  NOW()
FROM "BetaWaitlist"
WHERE NOT EXISTS (
  SELECT 1 FROM "User" WHERE "User".email = "BetaWaitlist".email
);

-- Show counts after migration
SELECT 'After migration:' as status;
SELECT
  (SELECT COUNT(*) FROM "BetaWaitlist") as beta_waitlist_count,
  (SELECT COUNT(*) FROM "User" WHERE role = 'WAITLIST') as total_waitlist_users;

-- Verify: Check for any BetaWaitlist emails that weren't migrated
SELECT 'Emails NOT migrated (should be 0):' as status;
SELECT bw.email, bw.name
FROM "BetaWaitlist" bw
LEFT JOIN "User" u ON bw.email = u.email
WHERE u.id IS NULL;
