-- Cleanup script: Remove duplicate components before adding unique constraint
-- Run this BEFORE applying the migration if there are existing duplicates
--
-- Strategy: Keep the most recently updated component for each (bikeId, type, location) combo

-- First, view what will be deleted (run this to preview)
-- SELECT c1.id, c1."bikeId", c1.type, c1.location, c1."updatedAt"
-- FROM "Component" c1
-- WHERE EXISTS (
--   SELECT 1 FROM "Component" c2
--   WHERE c1."bikeId" = c2."bikeId"
--     AND c1.type = c2.type
--     AND c1.location = c2.location
--     AND c1."updatedAt" < c2."updatedAt"
-- );

-- Delete duplicates, keeping the most recently updated one
DELETE FROM "Component" c1
USING "Component" c2
WHERE c1."bikeId" = c2."bikeId"
  AND c1.type = c2.type
  AND c1.location = c2.location
  AND c1."updatedAt" < c2."updatedAt";
