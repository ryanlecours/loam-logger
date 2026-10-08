-- Public, read-only links to one window of a component's history
-- (loamlogger.app/share/component/<slug>). Each link is locked to its scope:
-- LIFETIME and SINCE_SERVICE stay live, RANGE is a fixed window. Revoking a
-- link deletes its row. Additive only.
CREATE TYPE "ComponentShareScope" AS ENUM ('LIFETIME', 'SINCE_SERVICE', 'RANGE');

CREATE TABLE "ComponentShare" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ComponentShareScope" NOT NULL,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComponentShare_slug_key" ON "ComponentShare"("slug");
CREATE INDEX "ComponentShare_componentId_idx" ON "ComponentShare"("componentId");
CREATE INDEX "ComponentShare_userId_idx" ON "ComponentShare"("userId");

ALTER TABLE "ComponentShare" ADD CONSTRAINT "ComponentShare_componentId_fkey"
    FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComponentShare" ADD CONSTRAINT "ComponentShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
