-- Follow-up to 20260927120000_component_lifetime_and_inspection_counters.
--
-- 1. An explicit "counters computed" marker.
--
-- That migration leaves the counter columns at 0 until the backfill runs, and
-- readers used `hoursSinceService = 0` to mean "not backfilled yet". A brand-new
-- part with no rides reads the same way, and worse, the fast-path ride increment
-- moves a not-yet-backfilled row off 0, after which readers trusted a lifetime
-- figure that only counted rides since the deploy. A nullable timestamp makes
-- the state explicit: NULL means the counters have never been derived from the
-- ledger and must not be read or incremented. lib/component-counters.ts sets it
-- on every recompute, so the backfill and any request that recomputes a part
-- both complete it.
ALTER TABLE "Component" ADD COLUMN "countersComputedAt" TIMESTAMP(3);

-- 2. Drop an index the composite now covers.
--
-- ("componentId", "kind", "performedAt") has componentId as its leading column,
-- so it serves every lookup the single-column index did.
DROP INDEX IF EXISTS "ServiceLog_componentId_idx";
