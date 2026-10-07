import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
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

/** A refreshed reading this close to the stored one is not rewritten. */
const READING_EPSILON = 1e-6;

/** Which logbook events reset which clock. */
const SERVICE_KINDS = ['SERVICE'] as const;
/** A service necessarily involves looking at the part, so it resets both. */
const INSPECTION_KINDS = ['SERVICE', 'INSPECTION'] as const;

export interface ComponentCounters {
  lifetimeHours: number;
  hoursSinceService: number;
  hoursSinceInspection: number;
}

/**
 * The component columns the counter rules read. Shared by every loader here so
 * a column the rules start to need cannot go missing from one of them.
 */
const COUNTER_COMPONENT_SELECT = {
  id: true,
  userId: true,
  bikeId: true,
  installedAt: true,
  createdAt: true,
  retiredAt: true,
  hoursUsed: true,
  priorHours: true,
} as const;

/** A component as the counter rules see it. */
type CounterComponent = HistoryComponent & { priorHours: number };

/** Load the component columns the counter rules read. */
async function loadComponent(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<CounterComponent | null> {
  const c = await (tx as TransactionClient).component.findUnique({
    where: { id: componentId },
    select: COUNTER_COMPONENT_SELECT,
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
  return deriveCounters(tx, component, await countedRideWhere(tx, component));
}

/**
 * The derivation behind computeComponentCounters, for callers that already hold
 * the component and its counted-ride predicate (the recompute builds both once
 * and shares them with the reading refresh).
 */
async function deriveCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  component: CounterComponent,
  where: Prisma.RideWhereInput | null
): Promise<ComponentCounters> {
  const componentId = component.id;
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
 */
async function persistCounters(
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
 * Re-derive every service reading the rider did not type in.
 *
 * A log's hoursAtService is the part's lifetime hours as of its date. Unless a
 * rider declared it (hoursAtServiceDeclared), it is a cache of the ledger like
 * the counters themselves, and goes stale whenever a ride dated before the
 * service arrives later: a Strava history import after the service was logged
 * is the common case. A stale reading leaves every one of those rides counted
 * as "since service". Refreshing on each recompute keeps the subtraction
 * honest, and it also moves pre-migration rows (which held the old
 * since-service figure) onto the lifetime scale.
 *
 * Declared readings are left alone: a pre-Loam service ("serviced at 300h") is
 * the rider's statement, and nothing in the ledger can check it.
 *
 * One ride read covers every reading: the part's counted rides come back in
 * start order once, and each log's reading is the running total of the rides
 * strictly before its date, the same rule lifetimeHoursAt applies. A per-log
 * aggregate would cost a query per log on every recompute, and the bulk paths
 * run a recompute for every part on a bike while holding row locks.
 *
 * Returns the number of readings that changed. Only those are written.
 */
async function refreshDerivedReadings(
  tx: TransactionClient | Prisma.TransactionClient,
  component: CounterComponent,
  where: Prisma.RideWhereInput | null
): Promise<number> {
  const client = tx as TransactionClient;
  const logs = await client.serviceLog.findMany({
    where: { componentId: component.id, hoursAtServiceDeclared: false },
    orderBy: [{ performedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, performedAt: true, hoursAtService: true },
  });
  if (!logs.length) return 0;

  const rides = where
    ? await client.ride.findMany({
        where,
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        select: { startTime: true, durationSeconds: true },
      })
    : [];

  // Logs and rides are both in date order, so one pass carries the total.
  let seconds = 0;
  let next = 0;
  let changed = 0;
  for (const log of logs) {
    while (next < rides.length && rides[next].startTime < log.performedAt) {
      seconds += rides[next].durationSeconds ?? 0;
      next += 1;
    }
    // See the note in lifetimeHoursAt about the `?? 0`.
    const reading = (component.priorHours ?? 0) + seconds / 3600;
    if (Math.abs(reading - log.hoursAtService) < READING_EPSILON) continue;
    await client.serviceLog.update({ where: { id: log.id }, data: { hoursAtService: reading } });
    changed += 1;
  }
  return changed;
}

/**
 * Take the component's row lock for the rest of the transaction.
 *
 * A recompute reads the ledger, then writes absolute values. Without the lock a
 * concurrent writer can land in between and be overwritten: a per-ride credit,
 * or another recompute that read an older ledger. Taking the lock first
 * serialises them. If the other writer already holds it, this waits until that
 * transaction commits, and under READ COMMITTED the ledger reads that follow
 * see its rows. If this takes it first, the other writer's increment waits and
 * lands on top of the value written here.
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

/** What a recompute did, for callers that report on it or invalidate by bike. */
export interface RecomputeResult {
  counters: ComponentCounters;
  readingsRefreshed: number;
  /** The part's current bike, for prediction-cache invalidation. */
  bikeId: string | null;
}

/**
 * Recompute and persist one component's counters, reporting what changed.
 * recomputeComponentCounters is the usual entry point.
 */
export async function recomputeComponentCountersWithStats(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<RecomputeResult | null> {
  await lockComponentRow(tx, componentId);
  const component = await loadComponent(tx, componentId);
  if (!component) return null;

  // Built once and shared: the refresh and the derivation count the same rides.
  const where = await countedRideWhere(tx, component);
  const readingsRefreshed = await refreshDerivedReadings(tx, component, where);
  const counters = await deriveCounters(tx, component, where);
  await persistCounters(tx, componentId, counters);
  return { counters, readingsRefreshed, bikeId: component.bikeId };
}

/**
 * Recompute and persist one component's counters. The single authoritative
 * write path: every mutation that can change a component's accrued hours
 * without going through the per-ride credit below ends here, so no caller has
 * to know the rule.
 *
 * Refreshes the part's derived service readings first (see
 * refreshDerivedReadings), so the result is right even for rows the backfill
 * has not reached, and stamps countersComputedAt so readers and the per-ride
 * credit trust it. Must run inside a transaction: it holds the component's row
 * lock throughout.
 *
 * Returns null when the component no longer exists, matching the tolerant
 * behavior of the path it replaces.
 */
export async function recomputeComponentCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  componentId: string
): Promise<ComponentCounters | null> {
  return (await recomputeComponentCountersWithStats(tx, componentId))?.counters ?? null;
}

// ---------------------------------------------------------------------------
// Per-ride credit: the fast path
// ---------------------------------------------------------------------------

/**
 * Floor every counter at zero after a debit, and on computed rows cap both
 * "since" counters (and hoursUsed, which tracks hoursSinceService) at the
 * floored lifetimeHours, so clamping one column cannot break
 * hoursSince* <= lifetimeHours until the next recompute. Uncomputed rows are
 * only floored: their lifetimeHours is 0, and capping their legacy hoursUsed to
 * it would wipe it.
 *
 * One statement: every SET expression reads the row as it was before the
 * UPDATE, hence the repeated GREATEST("lifetimeHours", 0).
 *
 * Logged when it changes anything, matching the warning deriveCounters gives
 * for a reading above lifetime. A clamp means the debit took a counter past
 * what the ledger supports (typically a declared reading above lifetime), so
 * the stored figures under-report until the part's next recompute.
 */
async function floorAndCapCounters(
  tx: TransactionClient | Prisma.TransactionClient,
  where: Prisma.Sql,
  context: Record<string, unknown>
): Promise<void> {
  const clamped = await (tx as TransactionClient).$executeRaw`
    UPDATE "Component" SET
      "lifetimeHours" = GREATEST("lifetimeHours", 0),
      "hoursUsed" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursUsed", 0)
        ELSE LEAST(GREATEST("hoursUsed", 0), GREATEST("lifetimeHours", 0)) END,
      "hoursSinceService" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursSinceService", 0)
        ELSE LEAST(GREATEST("hoursSinceService", 0), GREATEST("lifetimeHours", 0)) END,
      "hoursSinceInspection" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("hoursSinceInspection", 0)
        ELSE LEAST(GREATEST("hoursSinceInspection", 0), GREATEST("lifetimeHours", 0)) END
    WHERE (${where})
      AND (
        "hoursUsed" < 0 OR "lifetimeHours" < 0 OR "hoursSinceService" < 0 OR "hoursSinceInspection" < 0
        OR ("countersComputedAt" IS NOT NULL AND (
          "hoursUsed" > "lifetimeHours" OR "hoursSinceService" > "lifetimeHours"
          OR "hoursSinceInspection" > "lifetimeHours"))
      )`;
  if (clamped > 0) {
    logger.warn(
      { ...context, clamped },
      '[component-counters] debit clamped counters; they under-report until the next recompute'
    );
  }
}

/**
 * Orders component ids the way Postgres orders them under COLLATE "C" (byte
 * order), so every path that takes several component row locks takes them in
 * the same order and two of them cannot deadlock each other.
 */
const byLockOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Take the row lock of every component loadBikeCandidates would return, in
 * byLockOrder, for the rest of the transaction. The WHERE must stay in step
 * with loadBikeCandidates.
 *
 * One statement: the rows are locked in ORDER BY order, and any row another
 * transaction holds is waited for, then re-checked against the WHERE as it
 * committed.
 */
async function lockBikeCandidates(
  tx: TransactionClient | Prisma.TransactionClient,
  userId: string,
  bikeId: string
): Promise<void> {
  await (tx as TransactionClient).$executeRaw`
    SELECT 1 FROM "Component"
    WHERE "userId" = ${userId}
      AND "countersComputedAt" IS NOT NULL
      AND ("bikeId" = ${bikeId} OR "id" IN (
        SELECT "componentId" FROM "BikeComponentInstall"
        WHERE "userId" = ${userId} AND "bikeId" = ${bikeId}))
    ORDER BY "id" COLLATE "C"
    FOR UPDATE`;
}

/**
 * Every computed component whose ride window could include a ride on `bikeId`:
 * those with any install row on it, plus those whose bikeId points at it (the
 * drifted rows normalizeTenures synthesizes a tenure for). A superset; callers
 * narrow it with the tenure rule. lockBikeCandidates locks the same set.
 */
async function loadBikeCandidates(
  tx: TransactionClient | Prisma.TransactionClient,
  userId: string,
  bikeId: string
) {
  const client = tx as TransactionClient;
  const installRows = await client.bikeComponentInstall.findMany({
    where: { userId, bikeId },
    orderBy: [{ installedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, componentId: true, bikeId: true, slotKey: true, installedAt: true, removedAt: true },
  });
  const components = await client.component.findMany({
    where: {
      userId,
      countersComputedAt: { not: null },
      OR: [{ bikeId }, { id: { in: [...new Set(installRows.map((r) => r.componentId))] } }],
    },
    select: COUNTER_COMPONENT_SELECT,
  });
  return { installRows, components };
}

/**
 * Credit (or, with a negative `hoursDelta`, debit) one ride to every component
 * whose counted window includes it, producing what a recompute would.
 *
 * The old fast path bumped every part currently on the bike, which is the same
 * shape of error this model exists to remove: a ride synced late, dated before
 * a part was fitted or while it was on another bike, was charged to it anyway,
 * and a ride dated before the part's last service was charged as "since
 * service". Here, for a ride at `startTime`:
 *
 *   - Only components with a tenure on this bike covering startTime count it,
 *     by the same normalizeTenures rule the recompute uses. That includes parts
 *     since moved elsewhere or retired.
 *   - lifetimeHours moves for each of them.
 *   - Every derived (not declared) service reading dated after startTime moves
 *     too, because that reading is "lifetime as of its date".
 *   - A "since" counter moves unless its latest resetting log is a derived
 *     reading dated after the ride. Then lifetime and reading moved together
 *     and the subtraction is unchanged: the ride happened before the service.
 *
 * Those decisions read the install rows and the logbook, so the candidates'
 * row locks are taken first, as a recompute takes its part's. A service logged,
 * re-dated or deleted concurrently commits either before the reads here (and is
 * seen) or after this transaction (and its recompute sees this ride). A part
 * first fitted to the bike after the lock is read unlocked, but the install's
 * own recompute has committed by then, so its logbook is already settled.
 *
 * Per-ride adjustments are not consulted. A new ride cannot have any, and the
 * callers that edit or delete an existing ride run
 * recomputeAdjustedComponentsForRides afterwards, whose recompute wins.
 *
 * Components whose counters were never computed get only the legacy hoursUsed
 * change, applied to the parts on the bike as before. Their counters are 0s,
 * not figures, and the recompute or backfill derives them.
 *
 * Returns the current bikeIds of the parts it changed, `bikeId` included, for
 * prediction-cache invalidation: a credited part may have moved since.
 */
export async function creditRideToComponents(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; startTime: Date; hoursDelta: number }
): Promise<string[]> {
  const { userId, bikeId, startTime, hoursDelta } = opts;
  if (hoursDelta === 0) return [];
  const client = tx as TransactionClient;

  await client.component.updateMany({
    where: { userId, bikeId, countersComputedAt: null },
    data: { hoursUsed: { increment: hoursDelta } },
  });
  if (hoursDelta < 0) {
    await floorAndCapCounters(
      tx,
      Prisma.sql`"userId" = ${userId} AND "bikeId" = ${bikeId} AND "countersComputedAt" IS NULL`,
      { bikeId, scope: 'uncomputed' }
    );
  }

  await lockBikeCandidates(tx, userId, bikeId);
  const { installRows, components } = await loadBikeCandidates(tx, userId, bikeId);
  const covering = components.filter((c) => {
    const rows = installRows.filter((r) => r.componentId === c.id);
    // Half-open, matching buildCountedRideWhere: gte start, lt end.
    return normalizeTenures(c, rows).tenures.some(
      (t) => t.bikeId === bikeId && t.start <= startTime && startTime < t.end
    );
  });
  if (!covering.length) return [bikeId];
  const coveringIds = covering.map((c) => c.id);

  // Newest first, so the first log of each kind per component is its latest.
  const logs = await client.serviceLog.findMany({
    where: { componentId: { in: coveringIds } },
    orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
    select: { componentId: true, kind: true, performedAt: true, hoursAtServiceDeclared: true },
  });
  type Log = (typeof logs)[number];
  const sinceMoves = (latest: Log | undefined) =>
    !(latest && !latest.hoursAtServiceDeclared && latest.performedAt > startTime);
  const resets = (kinds: readonly string[]) => (l: Log) => kinds.includes(l.kind);

  // At most four distinct updates, however many parts are credited.
  const groups = new Map<string, { service: boolean; inspection: boolean; ids: string[] }>();
  for (const id of coveringIds) {
    const own = logs.filter((l) => l.componentId === id);
    const service = sinceMoves(own.find(resets(SERVICE_KINDS)));
    const inspection = sinceMoves(own.find(resets(INSPECTION_KINDS)));
    const key = `${service}:${inspection}`;
    const group = groups.get(key) ?? { service, inspection, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }
  for (const { service, inspection, ids } of groups.values()) {
    await client.component.updateMany({
      where: { id: { in: ids } },
      data: {
        lifetimeHours: { increment: hoursDelta },
        ...(service
          ? { hoursSinceService: { increment: hoursDelta }, hoursUsed: { increment: hoursDelta } }
          : {}),
        ...(inspection ? { hoursSinceInspection: { increment: hoursDelta } } : {}),
      },
    });
  }

  // Strictly after, matching lifetimeHoursAt's strictly-before reading.
  await client.serviceLog.updateMany({
    where: {
      componentId: { in: coveringIds },
      hoursAtServiceDeclared: false,
      performedAt: { gt: startTime },
    },
    data: { hoursAtService: { increment: hoursDelta } },
  });

  if (hoursDelta < 0) {
    await floorAndCapCounters(tx, Prisma.sql`"id" = ANY(${coveringIds})`, {
      bikeId,
      componentIds: coveringIds,
    });
  }

  const bikeIds = new Set([bikeId]);
  for (const c of covering) if (c.bikeId) bikeIds.add(c.bikeId);
  return [...bikeIds];
}

/**
 * Interactive-transaction options for every caller of recomputeCountersForBike.
 *
 * The bulk paths (Strava gear mapping and unmapping, bulk ride assignment, a
 * provider's delete-imported-rides route) recompute every part ever fitted to
 * the bike inside one transaction, and Prisma's default limit is 5 seconds.
 * Measured on a throwaway Postgres (2026-10-07): a bike with 30 parts, 4 logs
 * each and 1,500 rides took ~0.3s and 302 queries; production's largest bike
 * has 520 rides and 29 parts. 30s leaves room for a bike far beyond that while
 * still failing a transaction that has genuinely stalled.
 */
export const BULK_RECOMPUTE_TX_OPTIONS = { timeout: 30_000 } as const;

/**
 * Recompute every computed component that could count rides on `bikeId`.
 *
 * For changes that move many rides at once (a Strava gear mapping, a bulk
 * reassignment, deleting a provider's imported rides). Crediting each ride
 * would cost several queries per ride; this costs one recompute per part that
 * has ever been on the bike, however many rides moved. Uncomputed parts on the
 * bike get the legacy hoursUsed change, as with a single ride.
 *
 * Returns the current bikeIds of the parts it changed, `bikeId` included.
 */
export async function recomputeCountersForBike(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; legacyHoursDelta: number }
): Promise<string[]> {
  const { userId, bikeId, legacyHoursDelta } = opts;
  if (legacyHoursDelta !== 0) {
    await (tx as TransactionClient).component.updateMany({
      where: { userId, bikeId, countersComputedAt: null },
      data: { hoursUsed: { increment: legacyHoursDelta } },
    });
  }
  if (legacyHoursDelta < 0) {
    await floorAndCapCounters(
      tx,
      Prisma.sql`"userId" = ${userId} AND "bikeId" = ${bikeId} AND "countersComputedAt" IS NULL`,
      { bikeId, scope: 'uncomputed' }
    );
  }
  const { components } = await loadBikeCandidates(tx, userId, bikeId);
  // Sorted, so concurrent bulk changes and ride credits take the row locks in
  // the same order.
  const sorted = [...components].sort((a, b) => byLockOrder(a.id, b.id));
  for (const c of sorted) await recomputeComponentCounters(tx, c.id);

  const bikeIds = new Set([bikeId]);
  for (const c of sorted) if (c.bikeId) bikeIds.add(c.bikeId);
  return [...bikeIds];
}
