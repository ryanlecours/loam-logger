-- Drop the unused per-component inspection interval (#333).
--
-- It set the interval of a separate inspection clock, which #331 removed:
-- inspections are optional stand-ins for a due service, not a schedule of their
-- own. Nothing has written it since, and it held no non-null values in
-- production when #333 was filed. The GraphQL field stays, resolving to null,
-- until mobile builds up to 1.3.0 that still select it have aged out.

-- AlterTable
ALTER TABLE "Component" DROP COLUMN "inspectionDueAtHours";
