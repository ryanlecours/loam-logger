import type { PrismaClient, Prisma } from '@prisma/client';

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
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId },
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
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId },
    data: { hoursUsed: { decrement: opts.hoursDelta } },
  });
  // Floor at zero
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, hoursUsed: { lt: 0 } },
    data: { hoursUsed: 0 },
  });
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
 * Previously duplicated inline in [webhooks.strava.ts] and [workers/sync.worker.ts].
 */
export async function syncBikeComponentHours(
  tx: Prisma.TransactionClient,
  userId: string,
  previous: { bikeId: string | null; durationSeconds: number | null | undefined },
  next: { bikeId: string | null; durationSeconds: number | null | undefined }
): Promise<void> {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const hoursDiff = nextHours - prevHours;

  if (prevBikeId) {
    if (bikeChanged) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: prevHours });
    } else if (hoursDiff < 0) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: Math.abs(hoursDiff) });
    }
  }

  if (nextBikeId) {
    if (bikeChanged) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: nextHours });
    } else if (hoursDiff > 0) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: hoursDiff });
    }
  }
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
  if (includedRideIds.length) {
    const { _sum, _count } = await tx.ride.aggregate({
      where: {
        userId: component.userId,
        id: { in: includedRideIds },
        isDuplicate: false,
        ...windowFilter,
        ...(component.bikeId ? { NOT: { bikeId: component.bikeId } } : {}),
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
 * it. Returns the new value, or null when the component no longer exists
 * (no-op). Callers are responsible for prediction-cache invalidation.
 */
export async function recomputeComponentHours(
  tx: Prisma.TransactionClient,
  componentId: string
): Promise<number | null> {
  const attribution = await loadComponentAttribution(tx, componentId);
  if (!attribution) return null;

  const { hours } = await computeCountedHours(tx, attribution);
  await tx.component.update({
    where: { id: componentId },
    data: { hoursUsed: hours },
  });
  return hours;
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
