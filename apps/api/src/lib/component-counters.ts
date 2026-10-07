import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger';
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
 *
 * Strictly before `at`. The service pickers are date-only, so most services
 * arrive at midnight and a ride earlier that same day is counted as AFTER the
 * service. Deliberate: it errs toward an earlier due date, never a later one,
 * and the error is at most one day's riding. Counting same-day rides as before
 * would instead hide a real post-service ride whenever the rider serviced the
 * part in the morning and rode in the afternoon.
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
  // Clamped to [0, lifetimeHours]: hoursAtService for a pre-Loam service is
  // user-declared and can legitimately exceed what we can derive, a negative
  // "hours since" is never a truthful answer, and float error in the
  // subtraction must not break the hoursSince* <= lifetimeHours invariant.
  //
  // A reading well above lifetime is clamped but logged, not silently absorbed:
  // it means rides were deleted or priorHours was lowered after the service was
  // recorded, and the part now reads as just serviced.
  const since = (logged: number | undefined) => {
    if (logged === undefined) return lifetimeHours;
    if (logged > lifetimeHours + 0.01) {
      logger.warn(
        { componentId, hoursAtService: logged, lifetimeHours },
        '[component-counters] service reading exceeds lifetime hours; clamping to 0 since'
      );
    }
    return Math.min(lifetimeHours, Math.max(0, lifetimeHours - logged));
  };

  return {
    lifetimeHours,
    hoursSinceService: since(latestService?.hoursAtService),
    hoursSinceInspection: since(latestInspection?.hoursAtService),
  };
}

/**
 * Write a computed counter set to its component and mark it computed.
 *
 * `hoursUsed` is kept in lockstep with `hoursSinceService`. It is the column
 * every existing reader (prediction engine, dashboard, mobile) still consumes,
 * so writing both means this change corrects those surfaces rather than
 * requiring them all to migrate at once.
 *
 * Exported so the backfill script writes exactly what a recompute writes.
 */
export async function persistCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string,
  counters: ComponentCounters
): Promise<void> {
  await (tx as TransactionClient).component.update({
    where: { id: componentId },
    data: {
      lifetimeHours: counters.lifetimeHours,
      hoursSinceService: counters.hoursSinceService,
      hoursSinceInspection: counters.hoursSinceInspection,
      hoursUsed: counters.hoursSinceService,
      countersComputedAt: new Date(),
    },
  });
}

/**
 * Archive written by migration 20260927120000. Rows in it whose live copy still
 * has the same updatedAt hold hoursAtService on the OLD scale (the since-service
 * counter at the time) and have not been rescaled yet.
 */
const LEGACY_ARCHIVE = 'loam_archive."ServiceLog_pre_20260927"';

/**
 * Set once the archive is seen to be gone. It is dropped by hand after the
 * backfill and never comes back, so a process that has seen it missing can stop
 * asking. The reverse is not cached: a drop while the process runs must be
 * noticed, or the next query would reference a table that no longer exists.
 */
let legacyArchiveDropped = false;

/**
 * Test hook. Suites whose mocked clients do not model the archive declare it
 * dropped (the post-cleanup state); counter tests reset it to exercise the
 * rescale.
 */
export function setLegacyArchiveDropped(dropped: boolean): void {
  legacyArchiveDropped = dropped;
}

/**
 * Move any of a component's pre-migration service logs onto the lifetime scale.
 *
 * Runs inside every recompute, not only in the backfill script, because the
 * window between deploy and backfill is real: a ride sync or service write in
 * that window recomputes the part, and subtracting an old-scale reading from a
 * lifetime figure makes a serviced part look freshly serviced. Rescaling first
 * makes every recompute correct whether or not the backfill has reached it.
 *
 * Idempotent through updatedAt: the rescale write bumps it (Prisma @updatedAt),
 * so a rescaled row no longer matches its archived copy, and nor does a row a
 * rider has edited since the deploy (whose figure is already on the new scale).
 *
 * Returns the number of logs rescaled.
 */
export async function rescaleLegacyServiceLogs(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<number> {
  if (legacyArchiveDropped) return 0;

  const client = tx as TransactionClient;
  const [{ present }] = await client.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass('${LEGACY_ARCHIVE}') IS NOT NULL AS "present"`
  );
  if (!present) {
    legacyArchiveDropped = true;
    return 0;
  }

  const legacyLogs = await client.$queryRawUnsafe<{ id: string; performedAt: Date }[]>(
    `SELECT sl."id", sl."performedAt"
       FROM "ServiceLog" sl
       JOIN ${LEGACY_ARCHIVE} a ON a."id" = sl."id"
      WHERE sl."componentId" = $1
        AND sl."updatedAt" = a."updatedAt"`,
    componentId
  );
  if (!legacyLogs.length) return 0;

  // lifetimeHoursAt per log would reload the component, its tenures and its
  // adjustments every time. Build the counted-ride predicate once instead; only
  // the date bound differs between logs.
  const component = await loadComponent(tx, componentId);
  if (!component) return 0;
  const where = await countedRideWhere(tx, component);
  for (const log of legacyLogs) {
    // See the note in lifetimeHoursAt about the `?? 0`.
    const reading = (component.priorHours ?? 0) + (await countedHours(tx, where, log.performedAt));
    await client.serviceLog.update({ where: { id: log.id }, data: { hoursAtService: reading } });
  }
  return legacyLogs.length;
}

/**
 * Take the component's row lock for the rest of the transaction.
 *
 * A recompute reads the ledger, then writes absolute values. Without the lock a
 * concurrent writer can land in between and be overwritten: a fast-path ride
 * increment, or another recompute that read an older ledger. Taking the lock
 * first serialises them. If the other writer already holds it, this waits until
 * that transaction commits, and under READ COMMITTED the ledger reads that
 * follow see its rows. If this takes it first, the other writer's increment
 * waits and lands on top of the value written here.
 *
 * Only meaningful inside a transaction: on the root client the lock is released
 * as soon as the statement ends.
 */
export async function lockComponentRow(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<void> {
  await (tx as TransactionClient).$executeRaw`
    SELECT 1 FROM "Component" WHERE "id" = ${componentId} FOR UPDATE`;
}

/**
 * Recompute and persist one component's counters. The single authoritative
 * write path: every mutation that can change a component's accrued hours ends
 * here, so no caller has to know the rule.
 *
 * Rescales the part's legacy service logs first (see rescaleLegacyServiceLogs),
 * so the result is right even before the backfill has reached this row, and
 * stamps countersComputedAt so readers and the fast-path increment trust it.
 * Must run inside a transaction: it holds the component's row lock throughout.
 *
 * Returns null when the component no longer exists, matching the tolerant
 * behavior of the path it replaces.
 */
export async function recomputeComponentCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<ComponentCounters | null> {
  await lockComponentRow(tx, componentId);
  await rescaleLegacyServiceLogs(tx, componentId);
  const counters = await computeComponentCounters(tx, componentId);
  if (!counters) return null;

  await persistCounters(tx, componentId, counters);
  return counters;
}
