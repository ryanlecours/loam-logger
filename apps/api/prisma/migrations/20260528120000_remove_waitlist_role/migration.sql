-- Fully remove the WAITLIST role.
-- Safety first: convert any stray WAITLIST rows to FREE *before* the enum is
-- recreated, otherwise the USING cast below would fail on those rows. No-op if
-- there are none.
UPDATE "User" SET "role" = 'FREE' WHERE "role" = 'WAITLIST';

-- AlterEnum: recreate UserRole without WAITLIST.
-- Postgres can't drop an in-use enum value, so swap the type. The column default
-- references the old type, so drop it first and re-add it afterward.
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('FREE', 'PRO', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'FREE';
COMMIT;
