-- E-bike motor and battery become tracked component types.
--
-- Hours-only by design: neither type is registered in COMPONENT_WEIGHTS
-- (apps/api/src/services/prediction/config.ts), so the prediction engine
-- filters them out and they never produce a service interval or a health
-- state. Ride hours still accrue, because incrementBikeComponentHours
-- updates by (userId, bikeId) with no type filter.
--
-- Additive only, on purpose. Postgres allows ALTER TYPE ... ADD VALUE inside
-- the transaction Prisma wraps migrations in, but the new labels cannot be
-- USED in that same transaction. Any row-level backfill that references
-- 'MOTOR' or 'BATTERY' must therefore be a separate, later migration or an
-- out-of-band script, never appended to this file.
ALTER TYPE "ComponentType" ADD VALUE 'MOTOR';
ALTER TYPE "ComponentType" ADD VALUE 'BATTERY';
