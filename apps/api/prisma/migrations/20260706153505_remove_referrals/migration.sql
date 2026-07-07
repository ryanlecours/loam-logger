-- Referral program removed: drop the Referral table, User.referralCode, the
-- ReferralStatus enum, and the referral_success EmailType value (with its rows).

-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_referrerUserId_fkey";
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_referredUserId_fkey";

-- DropTable
DROP TABLE "Referral";

-- DropEnum
DROP TYPE "ReferralStatus";

-- DropColumn (unique index User_referralCode_key is dropped with the column)
ALTER TABLE "User" DROP COLUMN "referralCode";

-- Remove referral_success from EmailType. Rows holding the removed value must be
-- deleted BEFORE the type swap or the USING cast fails. Postgres cannot drop an
-- enum value in place, so create a new type and swap.
DELETE FROM "EmailSend" WHERE "emailType" = 'referral_success';

CREATE TYPE "EmailType_new" AS ENUM (
  'activation',
  'welcome_series',
  'announcement',
  'custom',
  'founding_welcome',
  'founding_post_activation_info',
  'strava_integration_live',
  'suunto_integration_live',
  'beta_feature_roundup',
  'password_added',
  'password_changed',
  'password_reset',
  'upgrade_confirmation',
  'downgrade_notice',
  'payment_failed',
  'mobile_app_launch'
);
ALTER TABLE "EmailSend" ALTER COLUMN "emailType" TYPE "EmailType_new" USING ("emailType"::text::"EmailType_new");
DROP TYPE "EmailType";
ALTER TYPE "EmailType_new" RENAME TO "EmailType";
