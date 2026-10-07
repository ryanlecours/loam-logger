-- Read-only preview of migration 20260927120000's ServiceLog cleanup.
--
-- Run against a production snapshot BEFORE the migration deploys:
--   psql "$SNAPSHOT_DATABASE_URL" -f scripts/preview-install-anchor-cleanup.sql
--
-- "new_rule" is the predicate the migration uses (created in the same
-- transaction as the part or an install, and dated to that moment).
-- "old_rule" is the timestamp-only predicate it replaced, kept here for
-- comparison. The two disagreement buckets are the ones to read row by row:
--
--   old_only  zero-hour rows dated to installedAt that were NOT created
--             alongside the part. These are the genuine same-day services the
--             old rule would have deleted.
--   new_only  anchors the old rule missed, mostly parts since moved to
--             inventory (installedAt nulled) or refitted (installedAt moved).
--
-- Also reports how many surviving rows the backfill will rescale onto the
-- lifetime scale.

WITH classified AS (
  SELECT
    sl."id",
    sl."componentId",
    sl."performedAt",
    sl."createdAt",
    c."installedAt" AS "componentInstalledAt",
    (
      sl."hoursAtService" = 0
      AND sl."notes" IS NULL
      AND c."installedAt" IS NOT NULL
      AND sl."performedAt" = c."installedAt"
    ) AS old_rule,
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
    ) AS new_rule
  FROM "ServiceLog" sl
  JOIN "Component" c ON c."id" = sl."componentId"
)
SELECT
  count(*)                                        AS total_service_logs,
  count(*) FILTER (WHERE old_rule)                AS old_rule_deletes,
  count(*) FILTER (WHERE new_rule)                AS new_rule_deletes,
  count(*) FILTER (WHERE old_rule AND NOT new_rule) AS old_only,
  count(*) FILTER (WHERE new_rule AND NOT old_rule) AS new_only,
  count(*) FILTER (WHERE NOT new_rule)            AS survivors_to_rescale
FROM classified;

-- Row detail for the disagreements. Expect old_only to be empty or tiny; every
-- row in it is one the old rule would have destroyed.
WITH classified AS (
  SELECT
    sl."id",
    sl."componentId",
    sl."performedAt",
    sl."createdAt",
    c."createdAt"   AS "componentCreatedAt",
    c."installedAt" AS "componentInstalledAt",
    (
      sl."hoursAtService" = 0
      AND sl."notes" IS NULL
      AND c."installedAt" IS NOT NULL
      AND sl."performedAt" = c."installedAt"
    ) AS old_rule,
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
    ) AS new_rule
  FROM "ServiceLog" sl
  JOIN "Component" c ON c."id" = sl."componentId"
)
SELECT
  CASE WHEN old_rule THEN 'old_only' ELSE 'new_only' END AS bucket,
  "id", "componentId", "performedAt", "createdAt",
  "componentCreatedAt", "componentInstalledAt"
FROM classified
WHERE old_rule <> new_rule
ORDER BY bucket, "createdAt"
LIMIT 200;
