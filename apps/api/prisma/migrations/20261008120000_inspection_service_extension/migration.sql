-- An inspection stands in for a due service when the part is still in good
-- shape: the rider says how many more hours it can run before the next
-- service. Loam suggests half the service interval.
--
-- ServiceLog.serviceExtensionHours holds that figure on INSPECTION rows.
-- Component.serviceExtensionHours caches it for the part's current service
-- cycle (the latest SERVICE-or-INSPECTION log, when that log is an
-- inspection), written by the counter recompute in lib/component-counters.ts.
--
-- Both columns are nullable and start empty. Production has no INSPECTION
-- rows, so nothing needs backfilling.
ALTER TABLE "ServiceLog" ADD COLUMN "serviceExtensionHours" DOUBLE PRECISION;
ALTER TABLE "Component" ADD COLUMN "serviceExtensionHours" DOUBLE PRECISION;
