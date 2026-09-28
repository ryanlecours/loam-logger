-- Component lifetime / service / inspection counters.
--
-- Replaces a single derived "hours since the anchor, on whichever bike the part
-- is on now" window with three explicit numbers:
--
--   priorHours            declared; hours accrued before Loam Logger saw the part
--   lifetimeHours         priorHours + every counted ride across every tenure
--   hoursSinceService     lifetimeHours - latest SERVICE log's hoursAtService
--   hoursSinceInspection  lifetimeHours - latest inspection-resetting log
--
-- Because both "since" counters are subtractions from lifetimeHours, the
-- invariant hoursSince* <= lifetimeHours holds by construction. The old rule
-- paired the component's CURRENT bikeId with an arbitrarily old service anchor
-- and had no tenure bound, so moving a serviced part onto a busier bike could
-- credit it hundreds of hours it was never fitted for (measured at 7x on a
-- realistic two-bike fixture).
--
-- Backfill note: this migration establishes columns and rewrites ServiceLog
-- semantics. It does NOT attempt to reconstruct lifetimeHours in SQL — that
-- requires the tenure x ride x adjustment attribution rule, which lives in
-- lib/component-counters.ts. Columns land at 0 and are populated by the
-- idempotent backfill script (scripts/backfill-component-counters.ts), run
-- after deploy. Reads tolerate 0 until then because the GraphQL layer falls
-- back to the legacy hoursUsed counter when lifetimeHours is 0.

-- 1. Inspection is a distinct event kind from service.
CREATE TYPE "ServiceLogKind" AS ENUM ('SERVICE', 'INSPECTION');

ALTER TABLE "ServiceLog"
  ADD COLUMN "kind" "ServiceLogKind" NOT NULL DEFAULT 'SERVICE';

-- 2. Component counters.
ALTER TABLE "Component"
  ADD COLUMN "priorHours"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "lifetimeHours"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "hoursSinceService"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "hoursSinceInspection" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "inspectionDueAtHours" DOUBLE PRECISION,
  ADD COLUMN "lastInspectedAt"      TIMESTAMP(3);

-- 3. Index supporting "latest log of kind K for component C".
CREATE INDEX "ServiceLog_componentId_kind_performedAt_idx"
  ON "ServiceLog" ("componentId", "kind", "performedAt");

-- 4. Retire the fictional install anchors.
--
-- Every install wrote a ServiceLog with hoursAtService = 0 whose only purpose
-- was to position the prediction anchor. They assert work that never happened,
-- and for a used part they also assert (falsely) that it had zero hours. The
-- install event itself is already recorded in BikeComponentInstall, so these
-- rows carry no information that is lost by removing them.
--
-- Scoped deliberately narrowly: hoursAtService = 0 AND no notes AND performedAt
-- equal to the component's installedAt. A genuine zero-hour service (a rider
-- servicing a part the day it was fitted) with notes or a different date is
-- preserved. Deleting these is safe under the NEW rule because it derives
-- hoursSinceService by subtraction rather than from an anchor date.
DELETE FROM "ServiceLog" sl
USING "Component" c
WHERE sl."componentId" = c."id"
  AND sl."hoursAtService" = 0
  AND sl."notes" IS NULL
  AND c."installedAt" IS NOT NULL
  AND sl."performedAt" = c."installedAt";
