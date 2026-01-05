-- Migration: Fix bike sortOrder values for existing bikes
-- This sets sortOrder based on createdAt order per user
-- Run this after deploying the sortOrder field changes

-- Update sortOrder for all bikes, grouped by user, ordered by createdAt
UPDATE "Bike" b
SET "sortOrder" = sub.row_num - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) as row_num
  FROM "Bike"
) sub
WHERE b.id = sub.id;

-- Verify the update
SELECT "userId", id, nickname, manufacturer, model, "sortOrder", "createdAt"
FROM "Bike"
ORDER BY "userId", "sortOrder";
