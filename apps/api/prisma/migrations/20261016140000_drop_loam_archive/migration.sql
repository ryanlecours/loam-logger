-- Drop the loam_archive schema (#324).
--
-- Migration 20260927120000_component_lifetime_and_inspection_counters copied
-- every ServiceLog row into loam_archive."ServiceLog_pre_20260927" before it
-- deleted the install-time anchor rows. It was the only backup for that delete,
-- and nothing has read it since the recompute stopped matching against it.
--
-- Checked read-only on 2026-10-16 before dropping:
--   staging:    the archive held 0 rows.
--   production: 1,119 archived rows (1,035 anchors, 84 kept). All 84 kept
--               services are still in ServiceLog, each anchor was the only one
--               on its part, every part that lost one still has an install
--               date, and every part created before the backfill has counters.
--               The two hand-edited readings the backfill changed were both
--               lower than ride history, so neither was pre-Loam wear to move
--               into prior hours. No rider reported a missing entry.
--
-- IF EXISTS, so a database without the schema (or a re-run) does not fail.

DROP SCHEMA IF EXISTS "loam_archive" CASCADE;
