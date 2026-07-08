-- Collapse FREE_LIGHT and FREE_FULL into a single FREE tier. Postgres cannot
-- remove enum values in place, so create a new type and swap, mapping the two
-- old free tiers to FREE via the USING cast.

ALTER TABLE "User" ALTER COLUMN "subscriptionTier" DROP DEFAULT;

CREATE TYPE "SubscriptionTier_new" AS ENUM ('FREE', 'PRO');

ALTER TABLE "User" ALTER COLUMN "subscriptionTier" TYPE "SubscriptionTier_new"
  USING (
    CASE
      WHEN "subscriptionTier"::text IN ('FREE_LIGHT', 'FREE_FULL') THEN 'FREE'
      ELSE "subscriptionTier"::text
    END::"SubscriptionTier_new"
  );

DROP TYPE "SubscriptionTier";
ALTER TYPE "SubscriptionTier_new" RENAME TO "SubscriptionTier";

ALTER TABLE "User" ALTER COLUMN "subscriptionTier" SET DEFAULT 'FREE';
