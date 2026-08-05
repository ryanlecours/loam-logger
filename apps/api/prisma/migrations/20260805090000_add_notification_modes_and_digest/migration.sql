-- Ride-sync push notifications gain a three-way mode, and the weekly
-- gear-health digest gains its columns.
--
-- rideSyncNotificationMode replaces notifyOnRideUpload as the source of
-- truth for "Ride Synced" pushes:
--   ALL           every new integration ride pushes (the original behavior)
--   ACTION_NEEDED only rides that need a bike assigned, or the account's
--                 first-ever synced ride
--   OFF           no ride-sync pushes
--
-- Existing users are backfilled from their boolean so nobody's behavior
-- changes with this deploy: true -> ALL, false -> OFF. The column default
-- (ACTION_NEEDED) therefore only ever applies to accounts created after it,
-- which is the deliberate new-user default: every push either asks for an
-- action or marks a milestone. notifyOnRideUpload is kept and written
-- through (mode OFF <=> false) because app versions <= 1.1.4 still toggle it.

CREATE TYPE "RideSyncNotificationMode" AS ENUM ('ALL', 'ACTION_NEEDED', 'OFF');

ALTER TABLE "User" ADD COLUMN "rideSyncNotificationMode" "RideSyncNotificationMode" NOT NULL DEFAULT 'ACTION_NEEDED';

UPDATE "User" SET "rideSyncNotificationMode" = CASE
  WHEN "notifyOnRideUpload" THEN 'ALL'::"RideSyncNotificationMode"
  ELSE 'OFF'::"RideSyncNotificationMode"
END;

-- Weekly digest: opt-in, off by default. timezone is IANA, uploaded by the
-- mobile client with the push token; the digest scheduler skips users
-- without one rather than guessing.
ALTER TABLE "User" ADD COLUMN "weeklyDigestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;

-- WEEKLY_DIGEST rows record "already sent this week"; RIDE_UPLOADED rows
-- (declared since the enum's creation but never written until now) implement
-- the ride-push burst-suppression window.
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_DIGEST';
