-- The rider's per-ride choice about whether a detected lift's climb counts in
-- the ride's elevation gain. Nullable on purpose: NULL is "no choice yet",
-- which every existing row is, and the API applies the default to it.
ALTER TABLE "Ride" ADD COLUMN "countLiftElevation" BOOLEAN;
