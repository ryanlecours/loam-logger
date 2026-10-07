import type { PrismaClient, Prisma } from '@prisma/client';
import {
  recomputeComponentCounters,
  recomputeComponents,
  creditRideToComponents,
} from './component-counters';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const secondsToHours = (seconds: number | null | undefined) => Math.max(0, seconds ?? 0) / 3600;

/** One ride's effect on a bike's parts. */
export interface RideHours {
  userId: string;
  bikeId: string;
  hoursDelta: number;
  /** The ride's start. Decides which parts' windows include it; see creditRideToComponents. */
  startTime: Date;
}

/**
 * Credit one ride's hours to the parts whose windows include it.
 * Skips if hoursDelta is zero or negative.
 *
 * Returns the bikeIds whose predictions the change can affect.
 */
export async function incrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: RideHours
): Promise<string[]> {
  if (opts.hoursDelta <= 0) return [];
  return creditRideToComponents(tx, opts);
}

/**
 * Debit one ride's hours from the parts whose windows include it, flooring
 * every counter at zero. Skips if hoursDelta is zero or negative.
 *
 * Returns the bikeIds whose predictions the change can affect.
 */
export async function decrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: RideHours
): Promise<string[]> {
  if (opts.hoursDelta <= 0) return [];
  return creditRideToComponents(tx, { ...opts, hoursDelta: -opts.hoursDelta });
}

/**
 * Where a ride sits, as far as component hours care. startTime is null only on
 * the side of a create or delete that has no ride (bikeId null there too).
 */
export interface RidePlacement {
  bikeId: string | null;
  durationSeconds: number | null | undefined;
  startTime: Date | null | undefined;
}

/**
 * Diff-based sync of component hours across an upsert.
 *
 * Given the previous (bikeId, durationSeconds, startTime) and next state of a
 * ride, credit/debit component hours correctly:
 *  - Bike or start changed: debit the old placement by the full previous
 *    duration, credit the new one by the full new duration. A new start can
 *    move the ride across an install or a service, so it is not a delta.
 *  - Same bike and start, longer ride: credit the delta.
 *  - Same bike and start, shorter ride: debit the absolute delta.
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
  previous: RidePlacement,
  next: RidePlacement,
  rideId?: string
): Promise<string[]> {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const startChanged = (previous.startTime?.getTime() ?? null) !== (next.startTime?.getTime() ?? null);
  const moved = bikeChanged || startChanged;
  const hoursDiff = nextHours - prevHours;

  // Bikes whose hours this call actually mutates, including bikes that parts
  // credited here have since moved to. Only these need their cached
  // predictions busted (a pure no-op leaves the set empty).
  const affectedBikeIds = new Set<string>();
  const note = (bikeIds: string[]) => bikeIds.forEach((b) => affectedBikeIds.add(b));

  if (prevBikeId && previous.startTime) {
    if (moved) {
      note(await decrementBikeComponentHours(tx, {
        userId, bikeId: prevBikeId, hoursDelta: prevHours, startTime: previous.startTime,
      }));
    } else if (hoursDiff < 0) {
      note(await decrementBikeComponentHours(tx, {
        userId, bikeId: prevBikeId, hoursDelta: Math.abs(hoursDiff), startTime: previous.startTime,
      }));
    }
  }

  if (nextBikeId && next.startTime) {
    if (moved) {
      note(await incrementBikeComponentHours(tx, {
        userId, bikeId: nextBikeId, hoursDelta: nextHours, startTime: next.startTime,
      }));
    } else if (hoursDiff > 0) {
      note(await incrementBikeComponentHours(tx, {
        userId, bikeId: nextBikeId, hoursDelta: hoursDiff, startTime: next.startTime,
      }));
    }
  }

  if (rideId && (moved || hoursDiff !== 0)) {
    const adjustedBikeIds = await recomputeAdjustedComponentsForRides(tx, { rideIds: [rideId] });
    for (const bikeId of adjustedBikeIds) affectedBikeIds.add(bikeId);
  }

  return [...affectedBikeIds];
}

// ---------------------------------------------------------------------------
// Per-component attribution: adjustments and the service anchor
// ---------------------------------------------------------------------------
//
// The counters themselves are written only by lib/component-counters.ts: the
// per-ride credit above (creditRideToComponents) and the tenure-aware
// recompute. Convention: the per-ride credit runs first and ignores
// adjustments; then recomputeAdjustedComponentsForRides recomputes the (rare)
// components whose adjustments reference the touched rides. That recompute is
// the last write in the transaction, so it wins.
//
// What remains here is the anchored attribution: the service anchor plus the
// EXCLUDE/INCLUDE sets. It no longer writes any counter. It serves readers
// that still describe "rides since the anchor" (the componentRides query, the
// history page's since-service ride list) and the adjustment mutations'
// `counted` flag:
//
//   anchor  = latest ServiceLog.performedAt ?? component.installedAt ?? null
//   counted = user's rides where isDuplicate = false
//             AND (anchor is null OR startTime >= anchor)
//             AND ( (bikeId == component.bikeId AND no EXCLUDE row)
//                   OR has INCLUDE row )
//
// It has no tenure bound, so it must never be used to set a counter again:
// that is the rule which charged a moved fork for its new bike's history.

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
 * per-ride credit has already run and ignores adjustments; this targeted pass
 * replaces the few adjusted components' counters with the full tenure-aware
 * recompute (lib/component-counters.ts), which locks the row, refreshes its
 * derived readings and keeps hoursUsed in lockstep with hoursSinceService.
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

  // One recompute per DISTINCT component carrying an adjustment on the touched
  // rides: normally zero, and bounded by the rarity of adjustments (manual
  // corrections) plus the 500-per-component cap.
  return recomputeComponents(tx, componentIds);
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
