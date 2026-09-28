import type { PrismaClient, Prisma } from '@prisma/client';
import {
  normalizeTenures,
  mergeWindows,
  buildCountedRideWhere,
  TENURE_CAP,
  type HistoryComponent,
} from './component-history';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ---------------------------------------------------------------------------
// Component counters: lifetime, since-service, since-inspection
// ---------------------------------------------------------------------------
//
// This module replaces the anchored-window rule in lib/component-hours.ts with
// three explicit numbers, two of which are subtractions from the first:
//
//   lifetimeHours        = priorHours + every counted ride across every tenure
//   hoursSinceService    = lifetimeHours - latest SERVICE log's hoursAtService
//   hoursSinceInspection = lifetimeHours - latest SERVICE-or-INSPECTION log's
//
// Why this shape, and not the old one:
//
// The old rule was `rides on component.bikeId since (latest service ?? install)`
// — it paired the bike the part is on NOW with an anchor set at an arbitrary
// point in the past, and had no tenure bound and no upper bound. Moving a
// serviced part onto a busier bike therefore credited it every ride that bike
// had done since the old anchor. On a realistic two-bike fixture that measured
// 7x (210h charged to a fork with 30h on it), and because the prediction engine
// reimplemented the same rule, the two agreed with each other and the error was
// invisible. See engine.ts's getRidesSinceDateForComponent.
//
// Deriving both "since" counters by subtracting from one monotonic lifetime
// figure makes `hoursSince* <= lifetimeHours` STRUCTURAL rather than
// coincidental. There is no anchor to get out of step with the bike pointer,
// because there is no anchor.
//
// Stored, but ledger-backed. These are caches on Component for cheap reads; the
// ledger (BikeComponentInstall x Ride x ServiceLog) remains the source of
// truth, so backdating a service, editing a ride's duration, deleting a ride,
// reassigning a ride to another bike, editing an install date and per-ride
// EXCLUDE/INCLUDE adjustments all still self-heal via a recompute. Plain
// incremental counters would drift under every one of those.
//
// `priorHours` is the one number that is DECLARED and never derived: hours the
// part accrued before Loam Logger existed for it. A rider fitting used wheels
// states it. No amount of ride data can reconstruct it, and the old model's
// only way to express it was to backdate a fictional service — which is why
// installs wrote `hoursAtService: 0` logs into the rider's logbook.

/** Which logbook events reset which clock. */
const SERVICE_KINDS = ['SERVICE'] as const;
/** A service necessarily involves looking at the part, so it resets both. */
const INSPECTION_KINDS = ['SERVICE', 'INSPECTION'] as const;

export interface ComponentCounters {
  lifetimeHours: number;
  hoursSinceService: number;
  hoursSinceInspection: number;
}

/** Load the component columns the counter rules read. */
async function loadComponent(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<(HistoryComponent & { priorHours: number }) | null> {
  const c = await (tx as TransactionClient).component.findUnique({
    where: { id: componentId },
    select: {
      id: true,
      userId: true,
      bikeId: true,
      installedAt: true,
      createdAt: true,
      retiredAt: true,
      hoursUsed: true,
      priorHours: true,
    },
  });
  return c ?? null;
}

/**
 * Build the Prisma `where` selecting every ride counted toward a component's
 * lifetime, from its install tenures. Returns null when nothing is
 * attributable, so callers skip the query rather than issue an always-false one.
 */
async function countedRideWhere(
  tx: TransactionClient | Prisma.TransactionClient,
  component: HistoryComponent
): Promise<Prisma.RideWhereInput | null> {
  const [installRows, adjustments] = await Promise.all([
    (tx as TransactionClient).bikeComponentInstall.findMany({
      where: { componentId: component.id, userId: component.userId },
      orderBy: [{ installedAt: 'asc' }, { id: 'asc' }],
      take: TENURE_CAP,
      select: { id: true, bikeId: true, slotKey: true, installedAt: true, removedAt: true },
    }),
    (tx as TransactionClient).componentRideAdjustment.findMany({
      where: { componentId: component.id },
      select: { rideId: true, kind: true },
    }),
  ]);

  const { tenures } = normalizeTenures(component, installRows);
  return buildCountedRideWhere({
    userId: component.userId,
    windows: mergeWindows(tenures),
    includedRideIds: adjustments.filter((a) => a.kind === 'INCLUDE').map((a) => a.rideId),
    excludedRideIds: adjustments.filter((a) => a.kind === 'EXCLUDE').map((a) => a.rideId),
  });
}

/**
 * Ridden hours counted toward a component, optionally only those before a date.
 *
 * The `before` form is what makes a backdated service log honest: its
 * hoursAtService must be the component's lifetime figure AS OF that date, not
 * as of now, or the subtraction would hand back a negative "since" value.
 */
async function countedHours(
  tx: TransactionClient | Prisma.TransactionClient,
  where: Prisma.RideWhereInput | null,
  before?: Date
): Promise<number> {
  if (!where) return 0;
  const scoped: Prisma.RideWhereInput = before
    ? { AND: [where, { startTime: { lt: before } }] }
    : where;
  const { _sum } = await (tx as TransactionClient).ride.aggregate({
    where: scoped,
    _sum: { durationSeconds: true },
  });
  return (_sum.durationSeconds ?? 0) / 3600;
}

/**
 * The component's lifetime hours as of a moment in time. Used when writing or
 * editing a log entry so its hoursAtService lands on the right scale.
 */
export async function lifetimeHoursAt(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string,
  at: Date
): Promise<number> {
  const component = await loadComponent(tx, componentId);
  if (!component) return 0;
  const where = await countedRideWhere(tx, component);
  // `?? 0` rather than trusting the column: priorHours is NOT NULL in the
  // database, but an undefined here would make lifetimeHours NaN and silently
  // poison every figure derived from it, including what lands in a logbook row.
  return (component.priorHours ?? 0) + (await countedHours(tx, where, at));
}

/**
 * Derive all three counters for one component from the ledger.
 *
 * Pure-ish: reads, computes, returns. `recomputeComponentCounters` persists.
 */
export async function computeComponentCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<ComponentCounters | null> {
  const component = await loadComponent(tx, componentId);
  if (!component) return null;

  const where = await countedRideWhere(tx, component);
  // See the note in lifetimeHoursAt about the `?? 0`.
  const lifetimeHours = (component.priorHours ?? 0) + (await countedHours(tx, where));

  const [latestService, latestInspection] = await Promise.all([
    (tx as TransactionClient).serviceLog.findFirst({
      where: { componentId, kind: { in: [...SERVICE_KINDS] } },
      orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
      select: { hoursAtService: true },
    }),
    (tx as TransactionClient).serviceLog.findFirst({
      where: { componentId, kind: { in: [...INSPECTION_KINDS] } },
      orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
      select: { hoursAtService: true },
    }),
  ]);

  // No log of that kind means the clock has never been reset, so everything the
  // part has ever done counts — including its declared prior hours, because an
  // unserviced used part really is carrying that wear.
  //
  // Clamped at zero: hoursAtService for a pre-Loam service is user-declared and
  // can legitimately exceed what we can derive, and a negative "hours since"
  // is never a truthful answer.
  const since = (logged: number | undefined) =>
    logged === undefined ? lifetimeHours : Math.max(0, lifetimeHours - logged);

  return {
    lifetimeHours,
    hoursSinceService: since(latestService?.hoursAtService),
    hoursSinceInspection: since(latestInspection?.hoursAtService),
  };
}

/**
 * Recompute and persist one component's counters. The single authoritative
 * write path — every mutation that can change a component's accrued hours ends
 * here, so no caller has to know the rule.
 *
 * `hoursUsed` is kept in lockstep with `hoursSinceService`. It is the column
 * every existing reader (prediction engine, dashboard, mobile) still consumes,
 * so writing both means this change corrects those surfaces rather than
 * requiring them all to migrate at once.
 *
 * Returns null when the component no longer exists, matching the tolerant
 * behavior of the path it replaces.
 */
export async function recomputeComponentCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<ComponentCounters | null> {
  const counters = await computeComponentCounters(tx, componentId);
  if (!counters) return null;

  await (tx as TransactionClient).component.update({
    where: { id: componentId },
    data: {
      lifetimeHours: counters.lifetimeHours,
      hoursSinceService: counters.hoursSinceService,
      hoursSinceInspection: counters.hoursSinceInspection,
      hoursUsed: counters.hoursSinceService,
    },
  });
  return counters;
}

/**
 * Recompute every component that could be affected by a set of bikes' rides
 * changing: anything with a tenure on one of those bikes, plus anything whose
 * per-ride adjustments reference the touched rides.
 *
 * Tenure-based rather than `Component.bikeId`-based on purpose. A ride added to
 * bike B changes the lifetime hours of every part that was *ever* fitted to B,
 * not just the parts on it today — which is exactly the case the old
 * bikeId-scoped bulk helpers could not see.
 */
export async function recomputeCountersForBikes(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeIds: (string | null | undefined)[]; rideIds?: string[] }
): Promise<string[]> {
  const bikeIds = [...new Set(opts.bikeIds.filter((b): b is string => !!b))];

  const componentIds = new Set<string>();

  if (bikeIds.length) {
    const tenures = await (tx as TransactionClient).bikeComponentInstall.findMany({
      where: { userId: opts.userId, bikeId: { in: bikeIds } },
      select: { componentId: true },
      distinct: ['componentId'],
    });
    for (const t of tenures) componentIds.add(t.componentId);

    // Defence in depth: a component whose bikeId points at a touched bike but
    // whose install row is missing (the orphan drift installComponent sweeps
    // for) would otherwise be skipped by the tenure query above.
    const orphans = await (tx as TransactionClient).component.findMany({
      where: { userId: opts.userId, bikeId: { in: bikeIds } },
      select: { id: true },
    });
    for (const o of orphans) componentIds.add(o.id);
  }

  if (opts.rideIds?.length) {
    const adjusted = await (tx as TransactionClient).componentRideAdjustment.findMany({
      where: { rideId: { in: opts.rideIds } },
      select: { componentId: true },
      distinct: ['componentId'],
    });
    for (const a of adjusted) componentIds.add(a.componentId);
  }

  const affectedBikeIds = new Set<string>(bikeIds);
  for (const componentId of componentIds) {
    const counters = await computeComponentCounters(tx, componentId);
    if (!counters) continue;
    await (tx as TransactionClient).component.update({
      where: { id: componentId },
      data: {
        lifetimeHours: counters.lifetimeHours,
        hoursSinceService: counters.hoursSinceService,
        hoursSinceInspection: counters.hoursSinceInspection,
        hoursUsed: counters.hoursSinceService,
      },
    });
  }

  // Callers use this to target prediction-cache invalidation.
  const touched = await (tx as TransactionClient).component.findMany({
    where: { id: { in: [...componentIds] }, bikeId: { not: null } },
    select: { bikeId: true },
  });
  for (const t of touched) if (t.bikeId) affectedBikeIds.add(t.bikeId);

  return [...affectedBikeIds];
}
