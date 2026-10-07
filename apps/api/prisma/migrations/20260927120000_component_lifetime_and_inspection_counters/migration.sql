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
-- after deploy. Reads tolerate the gap because they key on
-- Component.countersComputedAt (added by 20261006120000), not on the counter
-- values: while it is NULL the prediction engine falls back to its ride window
-- and ride credits only move the legacy hoursUsed. Any recompute, or the
-- backfill, derives the counters and sets it.

-- 0. Snapshot every ServiceLog row before anything below touches the table.
--
-- It is the backup for step 4's DELETE, which is otherwise irreversible. No
-- code reads it: the rows that predate this migration hold hoursAtService on
-- the OLD scale (the since-service counter at the time), and every recompute
-- re-derives undeclared readings from their dates, which moves those rows onto
-- the lifetime scale without needing to identify them.
--
-- Lives in its own schema so Prisma never sees it: a table in "public" that
-- schema.prisma does not declare would show up as drift, and the next
-- `migrate dev` would generate a DROP for it. Drop the schema by hand once the
-- backfill has run and the logbooks have been checked (issue #324).
--
-- The anchor predicate is evaluated here, once, and step 4 deletes by this flag,
-- so the archive records precisely what was removed.
--
-- An install anchor was always written in the same transaction as either the
-- component (new part) or a BikeComponentInstall row (existing part fitted), and
-- always dated to that moment. So a row counts as an anchor only when BOTH hold:
--
--   created within 30s of its component, or of one of its install rows, AND
--   dated exactly at the component's creation, its installedAt, or one of its
--   install rows' installedAt.
--
-- Matching against install history, not only Component.installedAt, catches
-- anchors that predicate alone missed: installedAt is nulled when a part goes
-- to inventory and overwritten when it is refitted, which orphaned the earlier
-- anchors. The createdAt condition is what protects a genuine same-day service
-- with no notes: logging one takes a separate request after the part exists,
-- which lands far outside 30s even when a date-only picker normalises its
-- timestamp to match the install exactly.
CREATE SCHEMA IF NOT EXISTS "loam_archive";

-- A previous run can have left an archive here: `prisma migrate reset` drops
-- only the public schema, so replaying migrations on a reset database finds the
-- old table and CREATE TABLE fails. Move any existing archive aside under a
-- timestamped name rather than dropping it: this step must never destroy the
-- only backup of rows a run deleted. Its primary-key index is renamed with it,
-- or the new table's ADD PRIMARY KEY would collide with the old index name.
DO $archive$
DECLARE
  suffix text := to_char(clock_timestamp(), 'YYYYMMDD"T"HH24MISSMS');
BEGIN
  IF to_regclass('"loam_archive"."ServiceLog_pre_20260927"') IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "loam_archive"."ServiceLog_pre_20260927" RENAME TO %I',
      'ServiceLog_pre_20260927_superseded_' || suffix);
  END IF;
  IF to_regclass('"loam_archive"."ServiceLog_pre_20260927_pkey"') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX "loam_archive"."ServiceLog_pre_20260927_pkey" RENAME TO %I',
      'ServiceLog_pre_20260927_superseded_' || suffix || '_pkey');
  END IF;
END
$archive$;

CREATE TABLE "loam_archive"."ServiceLog_pre_20260927" AS
SELECT
  sl.*,
  (
    sl."hoursAtService" = 0
    AND sl."notes" IS NULL
    AND (
      abs(extract(epoch FROM sl."createdAt" - c."createdAt")) <= 30
      OR EXISTS (
        SELECT 1 FROM "BikeComponentInstall" i
        WHERE i."componentId" = sl."componentId"
          AND abs(extract(epoch FROM sl."createdAt" - i."installedAt")) <= 30
      )
    )
    AND (
      sl."performedAt" = c."createdAt"
      OR sl."performedAt" = c."installedAt"
      OR EXISTS (
        SELECT 1 FROM "BikeComponentInstall" i
        WHERE i."componentId" = sl."componentId"
          AND i."installedAt" = sl."performedAt"
      )
    )
  ) AS "deletedAsInstallAnchor"
FROM "ServiceLog" sl
JOIN "Component" c ON c."id" = sl."componentId";

ALTER TABLE "loam_archive"."ServiceLog_pre_20260927" ADD PRIMARY KEY ("id");

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
-- Which rows qualify is decided in step 0 and recorded in the archive, where
-- every deleted row survives in full. Deleting these is safe under the NEW rule
-- because it derives hoursSinceService by subtraction rather than from an
-- anchor date.
DELETE FROM "ServiceLog" sl
USING "loam_archive"."ServiceLog_pre_20260927" a
WHERE a."id" = sl."id"
  AND a."deletedAsInstallAnchor";
