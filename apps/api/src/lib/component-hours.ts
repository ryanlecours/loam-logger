import type { PrismaClient, Prisma } from '@prisma/client';
import { recomputeComponentCounters } from './component-counters';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const secondsToHours = (seconds: number | null | undefined) => Math.max(0, seconds ?? 0) / 3600;

/**
 * Increment hoursUsed for all currently-installed components on a bike.
 * Skips if hoursDelta is zero or negative.
 */
export async function incrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; hoursDelta: number }
) {
  if (opts.hoursDelta <= 0) return;
  // All four counters move together. For the overwhelmingly common case — a ride
  // added to the bike a component is currently fitted to, inside its tenure —
  // incrementing is exactly right, and it keeps lifetimeHours monotonic without
  // a per-ride tenure query. The authoritative tenure-aware recompute
  // (lib/component-counters.ts) runs on the paths where the fast path cannot be
  // trusted: installs, swaps, services, ride edits and per-ride adjustments.
  //
  // Rows whose counters have never been computed (countersComputedAt NULL) get
  // only the legacy hoursUsed bump. Incrementing their zeroed counters would
  // produce a "lifetime" of just the rides since deploy, which readers would
  // then trust; the recompute or backfill derives the real figure instead.
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, countersComputedAt: { not: null } },
    data: {
      hoursUsed: { increment: opts.hoursDelta },
      lifetimeHours: { increment: opts.hoursDelta },
      hoursSinceService: { increment: opts.hoursDelta },
      hoursSinceInspection: { increment: opts.hoursDelta },
    },
  });
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, countersComputedAt: null },
    data: { hoursUsed: { increment: opts.hoursDelta } },
  });
}

/**
 * Decrement hoursUsed for all currently-installed components on a bike.
 * Floors hoursUsed at zero to prevent negative values.
 * Skips if hoursDelta is zero or negative.
 */
export async function decrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; hoursDelta: number }
) {
  if (opts.hoursDelta <= 0) return;
  // Same split as incrementBikeComponentHours: uncomputed rows only move hoursUsed.
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, countersComputedAt: { not: null } },
    data: {
      hoursUsed: { decrement: opts.hoursDelta },
      lifetimeHours: { decrement: opts.hoursDelta },
      hoursSinceService: { decrement: opts.hoursDelta },
      hoursSinceInspection: { decrement: opts.hoursDelta },
    },
  });
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, countersComputedAt: null },
    data: { hoursUsed: { decrement: opts.hoursDelta } },
  });
  // Floor each counter at zero: a decrement can legitimately overshoot one of
  // them (a part serviced mid-window has a small hoursSinceService but a large
  // lifetimeHours). On computed rows, also cap both "since" counters (and
  // hoursUsed, which tracks hoursSinceService) at the floored lifetimeHours, so
  // a clamp on one column cannot break hoursSince* <= lifetimeHours until the
  // next recompute. One statement: every SET expression reads the row as it was
  // before the UPDATE, hence the repeated GREATEST("lifetimeHours", 0).
  await (tx as TransactionClient).$executeRaw`
    UPDATE "Component" SET
      "lifetimeHours" = GREATEST("lifetimeHours", 0),
      "hoursUsed" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursUsed", 0)
        ELSE LEAST(GREATEST("hoursUsed", 0), GREATEST("lifetimeHours", 0)) END,
      "hoursSinceService" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursSinceService", 0)
        ELSE LEAST(GREATEST("hoursSinceService", 0), GREATEST("lifetimeHours", 0)) END,
      "hoursSinceInspection" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursSinceInspection", 0)
        ELSE LEAST(GREATEST("hoursSinceInspection", 0), GREATEST("lifetimeHours", 0)) END
    WHERE "userId" = ${opts.userId} AND "bikeId" = ${opts.bikeId}
      AND (
        "hoursUsed" < 0 OR "lifetimeHours" < 0 OR "hoursSinceService" < 0 OR "hoursSinceInspection" < 0
        OR ("countersComputedAt" IS NOT NULL AND (
          "hoursUsed" > "lifetimeHours" OR "hoursSinceService" > "lifetimeHours"
          OR "hoursSinceInspection" > "lifetimeHours"))
      )`;
}

/**
 * Diff-based sync of component hours across an upsert.
 *
 * Given the previous (bikeId, durationSeconds) and next state of a ride,
 * credit/debit component hours correctly:
 *  - Bike changed: decrement the old bike's components by the full previous
 *    duration, increment the new bike's components by the full new duration.
 *  - Same bike, longer ride: increment by the delta.
 *  - Same bike, shorter ride: decrement by the absolute delta.
 *  - No bike on either side: no-op.
 *
 * When `rideId` is provided (upsert of an EXISTING ride) and the prev/next
 * state actually differs, components whose ComponentRideAdjustment rows
 * reference that ride get a targeted canonical recompute afterwards — the
 * bulk updates above either mis-credit them (EXCLUDE) or never touch them
 * (cross-bike INCLUDE). Create paths omit rideId: a brand-new ride can't
 * be pre-adjusted (the adjustment row FK-references an existing ride).
 *
 * Returns every bikeId whose component hours changed here — the debited
 * previous bike, the credited next bike, AND any bikes owning adjusted
 * components recomputed from `rideId` — deduped, nulls dropped. Callers pass
 * this straight to `invalidateBikePredictionsForBikes`: the return is
 * self-sufficient, so no caller has to reconstruct the primary bike (the
 * cache key encodes no ride data, so a ride write can't self-invalidate).
 *
 * Previously duplicated inline in [webhooks.strava.ts] and [workers/sync.worker.ts].
 */
export async function syncBikeComponentHours(
  tx: Prisma.TransactionClient,
  userId: string,
  previous: { bikeId: string | null; durationSeconds: number | null | undefined },
  next: { bikeId: string | null; durationSeconds: number | null | undefined },
  rideId?: string
): Promise<string[]> {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const hoursDiff = nextHours - prevHours;

  // Bikes whose hoursUsed this call actually mutates — only these need their
  // cached predictions busted (a pure no-op leaves the set empty).
  const affectedBikeIds = new Set<string>();

  if (prevBikeId) {
    if (bikeChanged) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: prevHours });
      affectedBikeIds.add(prevBikeId);
    } else if (hoursDiff < 0) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: Math.abs(hoursDiff) });
      affectedBikeIds.add(prevBikeId);
    }
  }

  if (nextBikeId) {
    if (bikeChanged) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: nextHours });
      affectedBikeIds.add(nextBikeId);
    } else if (hoursDiff > 0) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: hoursDiff });
      affectedBikeIds.add(nextBikeId);
    }
  }

  if (rideId && (bikeChanged || hoursDiff !== 0)) {
    const adjustedBikeIds = await recomputeAdjustedComponentsForRides(tx, { rideIds: [rideId] });
    for (const bikeId of adjustedBikeIds) affectedBikeIds.add(bikeId);
  }

  return [...affectedBikeIds];
}

// ---------------------------------------------------------------------------
// Canonical per-component attribution (ComponentRideAdjustment-aware)
// ---------------------------------------------------------------------------
//
// The increment/decrement helpers above are the FAST path: they bulk-update
// every component currently on a bike and know nothing about per-component
// ride adjustments. The functions below are the AUTHORITATIVE path: they
// derive one component's hoursUsed from the canonical rule and overwrite the
// counter. Convention: bulk helpers run first, then a targeted recompute for
// the (rare) components whose adjustments reference the touched rides — the
// recompute is the last write in the transaction, so it wins.
//
// Canonical rule:
//   anchor  = latest ServiceLog.performedAt ?? component.installedAt ?? null
//   counted = user's rides where isDuplicate = false
//             AND (anchor is null OR startTime >= anchor)
//             AND ( (bikeId == component.bikeId AND no EXCLUDE row)
//                   OR has INCLUDE row )
//   hoursUsed = sum(counted.durationSeconds) / 3600
//
// INCLUDE respects the anchor: the prediction engine's hoursSinceService is
// definitionally "since last service", and counter/engine must agree. An
// INCLUDE on a ride older than the anchor is stored but dormant; it springs
// back if the anchor moves (service log deleted/backdated).

/** Everything needed to evaluate the canonical rule for one component. */
export interface ComponentAttribution {
  component: {
    id: string;
    userId: string;
    bikeId: string | null;
    installedAt: Date | null;
    hoursUsed: number;
  };
  anchor: Date | null;
  excludedRideIds: string[];
  includedRideIds: string[];
}

/**
 * Load the attribution inputs for a component: the component row, its
 * canonical anchor (latest service log, else installedAt, else null =
 * all-time), and its adjustment rows. Returns null when the component no
 * longer exists — callers treat that as a no-op, matching the tolerant
 * behavior of the service-log recompute path.
 */
export async function loadComponentAttribution(
  tx: Prisma.TransactionClient,
  componentId: string
): Promise<ComponentAttribution | null> {
  const component = await tx.component.findUnique({
    where: { id: componentId },
    select: { id: true, userId: true, bikeId: true, installedAt: true, hoursUsed: true },
  });
  if (!component) return null;

  const latestLog = await tx.serviceLog.findFirst({
    where: { componentId },
    orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
    select: { performedAt: true },
  });
  const anchor = latestLog?.performedAt ?? component.installedAt ?? null;

  const adjustments = await tx.componentRideAdjustment.findMany({
    where: { componentId },
    select: { rideId: true, kind: true },
  });

  return {
    component,
    anchor,
    excludedRideIds: adjustments.filter((a) => a.kind === 'EXCLUDE').map((a) => a.rideId),
    includedRideIds: adjustments.filter((a) => a.kind === 'INCLUDE').map((a) => a.rideId),
  };
}

/**
 * Sum the counted hours (and ride count) for a component per the canonical
 * rule. Shared by the recompute below and the componentRides query so the
 * displayed total and the stored counter cannot diverge.
 */
export async function computeCountedHours(
  tx: Prisma.TransactionClient,
  attribution: ComponentAttribution
): Promise<{ hours: number; rideCount: number }> {
  const { component, anchor, excludedRideIds, includedRideIds } = attribution;
  const windowFilter = anchor ? { startTime: { gte: anchor } } : {};

  let seconds = 0;
  let rideCount = 0;

  // On-bike branch: rides on the component's bike, minus EXCLUDEs.
  if (component.bikeId) {
    const { _sum, _count } = await tx.ride.aggregate({
      where: {
        userId: component.userId,
        bikeId: component.bikeId,
        isDuplicate: false,
        ...windowFilter,
        ...(excludedRideIds.length ? { id: { notIn: excludedRideIds } } : {}),
      },
      _sum: { durationSeconds: true },
      _count: true,
    });
    seconds += _sum.durationSeconds ?? 0;
    rideCount += _count;
  }

  // INCLUDE branch: cross-bike (or unassigned) rides explicitly applied.
  // When the component is on a bike, exclude that bike's rides here — a
  // stale INCLUDE row on a ride that later moved onto this bike must count
  // exactly once (it already counts via the on-bike branch).
  //
  // Cheap regardless of ride-history size: the `id: { in }` predicate is
  // served by the PK (Ride_pkey) and includedRideIds is bounded by the
  // 500-per-component adjustment cap — this is a bounded PK lookup, not a
  // window scan like the on-bike branch above.
  //
  // NULL-safety: the guard must be the OR-null shape, NOT `NOT:{bikeId}`.
  // Prisma compiles the scalar NOT to SQL `bikeId <> X`, which evaluates
  // UNKNOWN (row excluded) for NULL bikeId under three-valued logic — that
  // would silently drop UNASSIGNED included rides from the total (verified
  // against real Postgres; mocked tests cannot catch this).
  if (includedRideIds.length) {
    const { _sum, _count } = await tx.ride.aggregate({
      where: {
        userId: component.userId,
        id: { in: includedRideIds },
        isDuplicate: false,
        ...windowFilter,
        ...(component.bikeId
          ? { OR: [{ bikeId: null }, { bikeId: { not: component.bikeId } }] }
          : {}),
      },
      _sum: { durationSeconds: true },
      _count: true,
    });
    seconds += _sum.durationSeconds ?? 0;
    rideCount += _count;
  }

  return { hours: seconds / 3600, rideCount };
}

/**
 * Recompute one component's hoursUsed from the canonical rule and persist
 * it. Returns the new value together with the attribution used to derive
 * it (so callers needing the anchor/adjustments — e.g. the adjustment
 * mutations' `counted` flag — don't re-run the same three reads), or null
 * when the component no longer exists (no-op). Callers are responsible
 * for prediction-cache invalidation.
 */
export async function recomputeComponentHours(
  tx: Prisma.TransactionClient,
  componentId: string
): Promise<{ hours: number; attribution: ComponentAttribution } | null> {
  const attribution = await loadComponentAttribution(tx, componentId);
  if (!attribution) return null;

  // Delegates to the tenure-aware counter rule in lib/component-counters.ts,
  // which writes lifetimeHours, hoursSinceService, hoursSinceInspection AND
  // keeps hoursUsed in lockstep with hoursSinceService.
  //
  // Kept as a wrapper rather than replaced at ~15 call sites so every existing
  // mutation path picks up the corrected rule at once. `attribution` is still
  // returned because the ride-adjustment mutations use its anchor and
  // include/exclude sets to report whether a ride now counts.
  const counters = await recomputeComponentCounters(tx, componentId);
  if (!counters) return null;

  return { hours: counters.hoursSinceService, attribution };
}

/**
 * After a mutation deletes rides or changes their bikeId/duration/startTime,
 * recompute every component whose adjustments reference those rides. The
 * bulk updateMany paths have already run; this targeted pass overwrites the
 * few adjusted components with authoritative values.
 *
 * Ride DELETE callers must capture componentIds BEFORE the delete (the
 * adjustment rows cascade away with the ride) and pass them via
 * `componentIds`; update/reassignment callers can pass `rideIds`.
 *
 * Returns the distinct bikeIds of the recomputed components (non-null only)
 * so callers can extend prediction-cache invalidation beyond the ride's own
 * bike.
 */
export async function recomputeAdjustedComponentsForRides(
  tx: Prisma.TransactionClient,
  opts: { rideIds?: string[]; componentIds?: string[] }
): Promise<string[]> {
  let componentIds = opts.componentIds ?? [];
  if (!componentIds.length && opts.rideIds?.length) {
    const rows = await tx.componentRideAdjustment.findMany({
      where: { rideId: { in: opts.rideIds } },
      select: { componentId: true },
      distinct: ['componentId'],
    });
    componentIds = rows.map((r) => r.componentId);
  }
  if (!componentIds.length) return [];

  // Sequential on purpose — DO NOT wrap this loop in Promise.all. `tx` is a
  // Prisma interactive transaction: all its queries share one connection and
  // must run one at a time; firing the per-component work concurrently on the
  // same `tx` throws ("Transaction already closed") / corrupts the tx. The
  // per-component cost (3 metadata reads + 1-2 aggregates + 1 update) is
  // acceptable because `componentIds` is DISTINCT components carrying an
  // adjustment that references the touched rides — normally 0, and bounded by
  // the rarity of adjustments (manual corrections) plus the 500-per-component
  // cap. A bulk op touching many distinct adjusted components would pay this
  // serially; if that ever shows up in practice, batch the three metadata
  // reads across all componentIds (the ride.aggregate step stays per-component
  // — each has its own bike/anchor/excluded-id set) rather than parallelizing.
  const affectedBikeIds = new Set<string>();
  for (const componentId of componentIds) {
    const attribution = await loadComponentAttribution(tx, componentId);
    if (!attribution) continue;
    const { hours } = await computeCountedHours(tx, attribution);
    await tx.component.update({ where: { id: componentId }, data: { hoursUsed: hours } });
    if (attribution.component.bikeId) affectedBikeIds.add(attribution.component.bikeId);
  }
  return [...affectedBikeIds];
}

/**
 * Convenience for ride-delete paths: look up which components have
 * adjustments referencing the given rides. MUST run before the delete —
 * the rows cascade away with the ride.
 */
export async function findAdjustedComponentIdsForRides(
  tx: Prisma.TransactionClient,
  rideIds: string[]
): Promise<string[]> {
  if (!rideIds.length) return [];
  const rows = await tx.componentRideAdjustment.findMany({
    where: { rideId: { in: rideIds } },
    select: { componentId: true },
    distinct: ['componentId'],
  });
  return rows.map((r) => r.componentId);
}
