import type { PrismaClient, Prisma, Ride } from '@prisma/client';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ---------------------------------------------------------------------------
// Lifetime component history
// ---------------------------------------------------------------------------
//
// This module answers "what has this component been through, ever?" It is the
// deliberate counterpart to lib/component-hours.ts, and the two differ in one
// load-bearing way:
//
//   component-hours.ts  counts rides SINCE THE SERVICE ANCHOR, on the
//                       component's CURRENT bike, with no upper bound.
//   component-history.ts counts rides inside the component's INSTALL TENURES,
//                       across every bike it has ever been on, with no anchor.
//
// The anchor exists in the since-service path because Component.hoursUsed and
// the prediction engine's hoursSinceService are definitionally "since last
// service" and must agree (see the comment at component-hours.ts:128-139).
// Lifetime has no counterpart to agree with, and applying the anchor here
// would report a 300-hour fork serviced last week as having 12 hours on it.
//
// Canonical lifetime rule:
//
//   tenures = BikeComponentInstall where componentId = C and userId = U
//   window  = [installedAt, removedAt ?? C.retiredAt ?? NOW)
//   counted = user's rides where isDuplicate = false
//             AND NOT EXCLUDEd for C
//             AND ( startTime falls in any tenure window on that tenure's bike
//                   OR the ride is INCLUDEd for C )
//
// Three non-obvious invariants this file maintains:
//
//  1. Windows are HALF-OPEN. Every swap path writes removedAt(old) and
//     installedAt(new) from a single shared `now` const (resolvers.ts:5562 +
//     5690, swapComponents at 5972-6009). A closed interval would credit a
//     ride landing exactly on a swap instant to BOTH components.
//  2. Overlapping tenures are reachable, not theoretical. The partial unique
//     index only constrains rows where removedAt IS NULL; closed rows are
//     unconstrained, and updateBikeComponentInstall (resolvers.ts:3405),
//     bulkUpdateBikeComponentInstalls (3716) and updateBikeAcquisition (3561)
//     all validate within a single row only. So we coalesce per-bike intervals
//     before querying, which also bounds the OR arity we hand Postgres.
//  3. Every ride lands in AT MOST ONE bucket. Per-tenure totals are produced by
//     single-assignment rather than by re-filtering the ride list per tenure,
//     so `lifetime == sum(tenures) + adjustments` holds by construction. Users
//     add the tenure cards up; if they don't sum, that's the bug they report.
//
// Metrics are the RAW ride columns. The lift-corrected deltas
// (liftDurationSeconds et al) are written by workers/lift.worker.ts and read
// only by routes/admin.lift.ts and, for the ride's own displayed climb, by
// lib/ride-lift.ts (the rider's per-ride lift choice). The wear model
// (prediction/wear.ts:36-41), the engine (prediction/engine.ts:548-550),
// bikeHistory totals (resolvers.ts:1858) and component-hours.ts:208 are all
// raw. Subtracting here alone would make a component's lifetime hours smaller
// than the same rides' bikeHistory total with no explanation available to the
// rider.

/** Hard ceiling on tenure rows, in the spirit of bikeHistory's INSTALL_CAP. */
export const TENURE_CAP = 200;

export type ComponentHistoryCoverage =
  /** At least one real BikeComponentInstall row backs this history. */
  | 'FULL'
  /** No install rows; the tenure was reconstructed from Component columns. */
  | 'SYNTHETIC_FALLBACK'
  /** No install rows and no current bike — nothing is attributable. */
  | 'NO_TENURE_DATA';

/** A normalized, queryable tenure. `end` is always resolved to a real date. */
export interface NormalizedTenure {
  /** Install row id, or a synthetic marker when reconstructed. */
  id: string;
  bikeId: string;
  slotKey: string;
  start: Date;
  end: Date;
  /** The stored removedAt, kept for display: null still reads as "current". */
  removedAt: Date | null;
  /** True when this tenure was reconstructed rather than read from a row. */
  synthetic: boolean;
}

export interface UsageTotals {
  rideCount: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  firstRideAt: Date | null;
  lastRideAt: Date | null;
}

export const emptyTotals = (): UsageTotals => ({
  rideCount: 0,
  durationSeconds: 0,
  distanceMeters: 0,
  elevationGainMeters: 0,
  firstRideAt: null,
  lastRideAt: null,
});

type CountedRide = {
  id: string;
  bikeId: string | null;
  startTime: Date;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
};

const addRide = (totals: UsageTotals, ride: CountedRide): void => {
  totals.rideCount += 1;
  totals.durationSeconds += ride.durationSeconds;
  totals.distanceMeters += ride.distanceMeters;
  totals.elevationGainMeters += ride.elevationGainMeters;
  if (!totals.firstRideAt || ride.startTime < totals.firstRideAt) {
    totals.firstRideAt = ride.startTime;
  }
  if (!totals.lastRideAt || ride.startTime > totals.lastRideAt) {
    totals.lastRideAt = ride.startTime;
  }
};

/** The component columns the lifetime rule reads. */
export interface HistoryComponent {
  id: string;
  userId: string;
  bikeId: string | null;
  installedAt: Date | null;
  /** Always present on a real row; optional so a narrow select cannot crash. */
  createdAt?: Date | null;
  retiredAt: Date | null;
  hoursUsed: number;
}

export interface TenureResolution {
  tenures: NormalizedTenure[];
  coverage: ComponentHistoryCoverage;
  /** Component.bikeId disagrees with the open install rows, or we synthesized. */
  driftDetected: boolean;
  /** A tenure row was dropped as unusable, or the cap was hit. */
  historyIncomplete: boolean;
}

/**
 * Read the component's install rows and normalize them into queryable tenures,
 * repairing the three shapes of bad/missing data this table can be in.
 *
 * Exported separately from the aggregation so it can be unit-tested against
 * fixture rows without a database.
 */
export function normalizeTenures(
  component: HistoryComponent,
  rows: Array<{
    id: string;
    bikeId: string;
    slotKey: string;
    installedAt: Date;
    removedAt: Date | null;
  }>,
  now: Date = new Date()
): TenureResolution {
  const tenures: NormalizedTenure[] = [];
  let historyIncomplete = rows.length >= TENURE_CAP;
  let driftDetected = false;

  for (const row of rows) {
    // An open row on a component that has since been retired must stop at the
    // retirement, not run to NOW. The orphan sweep in installComponent
    // (resolvers.ts:5598-5635) retires the Component and closes no install
    // row, so `?? now` alone would accrue its old bike's rides forever.
    const end = row.removedAt ?? component.retiredAt ?? now;

    // updateBikeComponentInstall's guard is `<` (resolvers.ts:3419), so
    // removedAt == installedAt is legal, and rows predating that guard can be
    // inverted. Either would emit an always-false OR branch that silently
    // contributes nothing — drop them loudly instead.
    if (end <= row.installedAt) {
      historyIncomplete = true;
      continue;
    }

    tenures.push({
      id: row.id,
      bikeId: row.bikeId,
      slotKey: row.slotKey,
      start: row.installedAt,
      end,
      removedAt: row.removedAt,
      synthetic: false,
    });
  }

  // Drift repair: the component claims to be on a bike, but no row is open on
  // that bike. hoursUsed keeps growing through incrementBikeComponentHours
  // (which filters by {userId, bikeId} and knows nothing about install rows),
  // so without this the page would show hoursUsed > lifetime hours — an
  // obvious-looking bug with a non-obvious cause.
  if (component.bikeId) {
    const openOnCurrentBike = tenures.some(
      (t) => t.bikeId === component.bikeId && t.removedAt === null
    );
    if (!openOnCurrentBike) {
      const priorEnds = tenures
        .filter((t) => t.bikeId === component.bikeId)
        .map((t) => t.end.getTime());
      // A component row always has createdAt in the database, but treat it as
      // optional anyway: a caller projecting a narrow select should degrade to
      // "no synthetic tenure" rather than crash the whole prediction batch.
      const declaredStart = component.installedAt ?? component.createdAt ?? null;
      const floor = declaredStart
        ? Math.max(...priorEnds, declaredStart.getTime())
        : priorEnds.length
        ? Math.max(...priorEnds)
        : null;
      const start = floor === null ? null : new Date(floor);
      const end = component.retiredAt ?? now;
      if (start && end > start) {
        tenures.push({
          id: `synthetic:${component.id}:${component.bikeId}`,
          bikeId: component.bikeId,
          slotKey: 'UNKNOWN',
          start,
          end,
          removedAt: component.retiredAt,
          synthetic: true,
        });
      }
      driftDetected = true;
    }
  }

  tenures.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id)
  );

  let coverage: ComponentHistoryCoverage;
  if (tenures.length === 0) {
    // INVENTORY and RETIRED components have bikeId AND installedAt nulled
    // (resolvers.ts:5578-5585), so there is genuinely nothing to attribute.
    // Say so explicitly rather than returning zeros that read as "never ridden".
    coverage = 'NO_TENURE_DATA';
  } else if (rows.length === 0) {
    coverage = 'SYNTHETIC_FALLBACK';
  } else {
    coverage = 'FULL';
  }

  return { tenures, coverage, driftDetected, historyIncomplete };
}

/**
 * Coalesce overlapping and adjacent tenures on the same bike into the minimal
 * set of windows. Used only to build the ride query: display keeps the
 * unmerged tenures so the rider still sees each install as its own event.
 */
export function mergeWindows(
  tenures: NormalizedTenure[]
): Array<{ bikeId: string; start: Date; end: Date }> {
  const byBike = new Map<string, NormalizedTenure[]>();
  for (const t of tenures) {
    const list = byBike.get(t.bikeId);
    if (list) list.push(t);
    else byBike.set(t.bikeId, [t]);
  }

  const windows: Array<{ bikeId: string; start: Date; end: Date }> = [];
  for (const [bikeId, list] of byBike) {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
    let current = { bikeId, start: sorted[0].start, end: sorted[0].end };
    for (const t of sorted.slice(1)) {
      if (t.start <= current.end) {
        if (t.end > current.end) current = { ...current, end: t.end };
      } else {
        windows.push(current);
        current = { bikeId, start: t.start, end: t.end };
      }
    }
    windows.push(current);
  }
  return windows;
}

/**
 * Build the Prisma `where` that selects exactly the rides counted toward a
 * component's lifetime. Shared by the totals fold and the weather groupBy so
 * the bucket counts can never describe a different ride set than the totals.
 *
 * Returns null when nothing is attributable, so callers can skip the query
 * entirely rather than issuing an always-false one.
 */
export function buildCountedRideWhere(params: {
  userId: string;
  windows: Array<{ bikeId: string; start: Date; end: Date }>;
  includedRideIds: string[];
  excludedRideIds: string[];
  /** Narrow to rides starting in [start, end); either bound may be open. */
  range?: DateRange;
}): Prisma.RideWhereInput | null {
  const { userId, windows, includedRideIds, excludedRideIds, range } = params;

  const orBranches: Prisma.RideWhereInput[] = windows.map((w) => ({
    bikeId: w.bikeId,
    // Half-open: gte start, lt end. See invariant 1 in the header.
    startTime: { gte: w.start, lt: w.end },
  }));
  if (includedRideIds.length) {
    orBranches.push({ id: { in: includedRideIds } });
  }
  if (!orBranches.length) return null;

  const startTime = rangeFilter(range);
  return {
    userId,
    isDuplicate: false,
    ...(excludedRideIds.length ? { id: { notIn: excludedRideIds } } : {}),
    // A top-level key, so it narrows every branch, the INCLUDEd rides too.
    ...(startTime ? { startTime } : {}),
    OR: orBranches,
  };
}

/**
 * A window over a component's history: rides starting in [start, end). A null
 * bound is open, so { start: null, end: null } is the whole lifetime.
 */
export interface DateRange {
  start: Date | null;
  end: Date | null;
}

function rangeFilter(range: DateRange | undefined): Prisma.DateTimeFilter | null {
  if (!range || (!range.start && !range.end)) return null;
  return {
    ...(range.start ? { gte: range.start } : {}),
    ...(range.end ? { lt: range.end } : {}),
  };
}

export interface LifetimeAggregate {
  lifetime: UsageTotals;
  /**
   * The same counted rides, from the latest service on: startTime at or after
   * `sinceServiceAt`, or every ride when the part was never serviced. Matches
   * the counter rule exactly (lib/component-counters.ts): a derived reading
   * counts the rides strictly before its date, so "since" is the rest.
   */
  sinceService: UsageTotals;
  /** Keyed by NormalizedTenure.id, same order as the input tenures. */
  perTenure: Map<string, UsageTotals>;
  /** INCLUDEd rides that fell outside every tenure window. */
  adjustments: UsageTotals;
  /** The where clause used, so the weather groupBy can reuse it verbatim. */
  rideWhere: Prisma.RideWhereInput | null;
}

/**
 * Sum a component's lifetime usage and split it across its tenures.
 *
 * One findMany, then a single fold. Postgres returns distinct rows for an OR
 * disjunction no matter how many branches a row satisfies, so the query itself
 * cannot double-count; the single-assignment fold below is what keeps the
 * per-tenure split from doing so.
 */
export async function aggregateLifetime(
  tx: TransactionClient | Prisma.TransactionClient,
  params: {
    userId: string;
    tenures: NormalizedTenure[];
    includedRideIds: string[];
    excludedRideIds: string[];
    /** The latest SERVICE log's date; null when the part was never serviced. */
    sinceServiceAt?: Date | null;
    /**
     * Narrow every total to rides in this window (a shared link's scope). The
     * `lifetime` field then holds the window's totals.
     */
    range?: DateRange;
  }
): Promise<LifetimeAggregate> {
  const { userId, tenures, includedRideIds, excludedRideIds, range } = params;
  const sinceServiceAt = params.sinceServiceAt ?? null;

  const windows = mergeWindows(tenures);
  const rideWhere = buildCountedRideWhere({
    userId,
    windows,
    includedRideIds,
    excludedRideIds,
    range,
  });

  const perTenure = new Map<string, UsageTotals>();
  for (const t of tenures) perTenure.set(t.id, emptyTotals());

  const lifetime = emptyTotals();
  const sinceService = emptyTotals();
  const adjustments = emptyTotals();

  if (!rideWhere) {
    return { lifetime, sinceService, perTenure, adjustments, rideWhere };
  }

  // Served by @@index([userId, bikeId, startTime]) (schema.prisma:263) as a
  // BitmapOr of per-window index scans: leading equality on (userId, bikeId),
  // range on startTime. isDuplicate is a cheap post-filter.
  const rides = (await (tx as TransactionClient).ride.findMany({
    where: rideWhere,
    select: {
      id: true,
      bikeId: true,
      startTime: true,
      durationSeconds: true,
      distanceMeters: true,
      elevationGainMeters: true,
    },
    orderBy: { startTime: 'asc' },
  })) as CountedRide[];

  const included = new Set(includedRideIds);
  // Tenures are pre-sorted by (start, id), so "first match wins" is stable.
  for (const ride of rides) {
    const owner = tenures.find(
      (t) =>
        t.bikeId === ride.bikeId &&
        ride.startTime >= t.start &&
        ride.startTime < t.end
    );
    if (owner) {
      addRide(perTenure.get(owner.id)!, ride);
    } else if (included.has(ride.id)) {
      addRide(adjustments, ride);
    } else {
      // Unreachable given the where clause; counted into lifetime via the
      // fold below regardless, so a logic slip can never silently lose hours.
      addRide(adjustments, ride);
    }
    addRide(lifetime, ride);
    // Folded from the same rows, so the window costs no extra query.
    if (!sinceServiceAt || ride.startTime >= sinceServiceAt) addRide(sinceService, ride);
  }

  return { lifetime, sinceService, perTenure, adjustments, rideWhere };
}

/**
 * Monthly cumulative wear points for the history chart.
 *
 * Raw SQL because Prisma's groupBy cannot date_trunc, and folding thousands of
 * rows in JS to draw ~60 points is waste. Parameterized throughout — the
 * window branches included.
 */
export async function cumulativeSeries(
  tx: TransactionClient | Prisma.TransactionClient,
  params: {
    userId: string;
    windows: Array<{ bikeId: string; start: Date; end: Date }>;
    includedRideIds: string[];
    excludedRideIds: string[];
    /** Only rides in this window, so the series starts from 0 at its start. */
    range?: DateRange;
  }
): Promise<
  Array<{
    date: Date;
    cumulativeHours: number;
    cumulativeDistanceMeters: number;
    cumulativeElevationGainMeters: number;
  }>
> {
  const { userId, windows, includedRideIds, excludedRideIds, range } = params;
  if (!windows.length && !includedRideIds.length) return [];

  const { Prisma: P } = await import('@prisma/client');

  const branches: Prisma.Sql[] = windows.map(
    (w) =>
      P.sql`("bikeId" = ${w.bikeId} AND "startTime" >= ${w.start} AND "startTime" < ${w.end})`
  );
  if (includedRideIds.length) {
    branches.push(P.sql`"id" IN (${P.join(includedRideIds)})`);
  }

  const exclusion = excludedRideIds.length
    ? P.sql`AND "id" NOT IN (${P.join(excludedRideIds)})`
    : P.empty;
  const fromBound = range?.start ? P.sql`AND "startTime" >= ${range.start}` : P.empty;
  const toBound = range?.end ? P.sql`AND "startTime" < ${range.end}` : P.empty;

  const rows = await (tx as TransactionClient).$queryRaw<
    Array<{
      bucket: Date;
      seconds: bigint | number;
      meters: number;
      elevation: number;
    }>
  >(P.sql`
    SELECT date_trunc('month', "startTime") AS bucket,
           SUM("durationSeconds")      AS seconds,
           SUM("distanceMeters")       AS meters,
           SUM("elevationGainMeters")  AS elevation
      FROM "Ride"
     WHERE "userId" = ${userId}
       AND "isDuplicate" = false
       ${exclusion}
       ${fromBound}
       ${toBound}
       AND (${P.join(branches, ' OR ')})
     GROUP BY 1
     ORDER BY 1 ASC
  `);

  let hours = 0;
  let meters = 0;
  let elevation = 0;
  return rows.map((r) => {
    hours += Number(r.seconds ?? 0) / 3600;
    meters += Number(r.meters ?? 0);
    elevation += Number(r.elevation ?? 0);
    return {
      date: r.bucket,
      cumulativeHours: hours,
      cumulativeDistanceMeters: meters,
      cumulativeElevationGainMeters: elevation,
    };
  });
}

// ---------------------------------------------------------------------------
// Counted ride rows
// ---------------------------------------------------------------------------
//
// The rides behind the totals above, one row each. Distinct from the
// componentRides query, which lists the rides behind hoursUsed: those are on
// the component's CURRENT bike since the anchor, while these follow the tenure
// rule, so a list under a lifetime total holds exactly the rides it sums.

/** Largest page of ride rows a caller may ask for. */
export const RIDE_PAGE_MAX = 100;

/**
 * How deep offset paging may go. Postgres reads and discards every skipped
 * row, and the share page is public, so the depth is bounded; 10,000 rides is
 * far past any one part's life, and paging simply ends there.
 */
export const RIDE_OFFSET_MAX = 10_000;

export interface CountedRideBasis {
  tenures: NormalizedTenure[];
  includedRideIds: string[];
  excludedRideIds: string[];
  /** The latest SERVICE log's date; null when the part was never serviced. */
  latestServiceAt: Date | null;
}

/**
 * Read what the counted-ride rule needs for one component: its tenures, the
 * rider's per-ride adjustments and its latest service. The same reads the
 * history and share builders make, minus the parts only they need.
 */
export async function loadCountedRideBasis(
  db: TransactionClient | Prisma.TransactionClient,
  component: HistoryComponent
): Promise<CountedRideBasis> {
  const client = db as TransactionClient;
  const [adjustments, installRows, latestService] = await Promise.all([
    client.componentRideAdjustment.findMany({
      where: { componentId: component.id },
      select: { rideId: true, kind: true },
    }),
    client.bikeComponentInstall.findMany({
      where: { componentId: component.id, userId: component.userId },
      orderBy: [{ installedAt: 'asc' }, { id: 'asc' }],
      take: TENURE_CAP,
      select: { id: true, bikeId: true, slotKey: true, installedAt: true, removedAt: true },
    }),
    // An inspection that stood in for a service moves the due point, not the
    // date of the last service.
    client.serviceLog.findFirst({
      where: { componentId: component.id, kind: 'SERVICE' },
      orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
      select: { performedAt: true },
    }),
  ]);

  return {
    tenures: normalizeTenures(component, installRows).tenures,
    includedRideIds: adjustments.filter((a) => a.kind === 'INCLUDE').map((a) => a.rideId),
    excludedRideIds: adjustments.filter((a) => a.kind === 'EXCLUDE').map((a) => a.rideId),
    latestServiceAt: latestService?.performedAt ?? null,
  };
}

interface RidePageParams {
  userId: string;
  basis: CountedRideBasis;
  range?: DateRange;
  take: number;
  offset: number;
}

/**
 * One page of the counted rides in a window, newest first. Offset-paged so the
 * public share page can page without handing out ride ids; `take` is clamped
 * to [1, RIDE_PAGE_MAX] and one extra row is read to answer hasMore. Without a
 * `select` the rows are whole Rides, for the owner's GraphQL Ride type.
 */
export async function pageCountedRides(
  db: TransactionClient | Prisma.TransactionClient,
  params: RidePageParams
): Promise<{ rides: Ride[]; hasMore: boolean }>;
export async function pageCountedRides<S extends Prisma.RideSelect>(
  db: TransactionClient | Prisma.TransactionClient,
  params: RidePageParams & { select: S }
): Promise<{ rides: Prisma.RideGetPayload<{ select: S }>[]; hasMore: boolean }>;
export async function pageCountedRides(
  db: TransactionClient | Prisma.TransactionClient,
  params: RidePageParams & { select?: Prisma.RideSelect }
): Promise<{ rides: unknown[]; hasMore: boolean }> {
  const { userId, basis, range, select } = params;
  const where = buildCountedRideWhere({
    userId,
    windows: mergeWindows(basis.tenures),
    includedRideIds: basis.includedRideIds,
    excludedRideIds: basis.excludedRideIds,
    range,
  });
  const offset = Math.max(0, Math.floor(params.offset) || 0);
  if (!where || offset >= RIDE_OFFSET_MAX) return { rides: [], hasMore: false };

  // The page never reaches past the depth cap.
  const limit = Math.min(RIDE_PAGE_MAX, Math.max(1, Math.floor(params.take) || 1), RIDE_OFFSET_MAX - offset);
  const rows: unknown[] = await (db as TransactionClient).ride.findMany({
    where,
    ...(select ? { select } : {}),
    // id breaks startTime ties, so a page boundary never repeats or skips a row.
    orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    skip: offset,
    take: limit + 1,
  });

  const hasMore = rows.length > limit && offset + limit < RIDE_OFFSET_MAX;
  return { rides: rows.slice(0, limit), hasMore };
}

// ---------------------------------------------------------------------------
// Weather condition buckets
// ---------------------------------------------------------------------------
//
// Weather is Pro-only, and Ride.weather enforces that in a field resolver. An
// aggregate that reads RideWeather directly would walk straight around that
// gate, so the two helpers below make the gated and ungated answers the same
// SHAPE, and keep that guarantee testable without a live resolver.
//
// A gated viewer gets zeros rather than null or an error, matching
// User.weatherBreakdown: zeros are indistinguishable from "no rides had
// weather", which is the right amount of information to hand a free user.

/** Every WeatherCondition, in the order breakdowns render. */
export const WEATHER_CONDITIONS = [
  'SUNNY',
  'CLOUDY',
  'RAINY',
  'SNOWY',
  'WINDY',
  'FOGGY',
  'UNKNOWN',
] as const;

export type ConditionBucket = {
  condition: string;
  rideCount: number;
  durationSeconds: number;
};

/** The zeroed set a gated viewer receives. Same length and order as real data. */
export const emptyConditionBuckets = (): ConditionBucket[] =>
  WEATHER_CONDITIONS.map((condition) => ({
    condition,
    rideCount: 0,
    durationSeconds: 0,
  }));

/**
 * Fold weather rows into one bucket per condition, zero-filling the rest so a
 * client never has to distinguish "no rides in the rain" from "the rain bucket
 * was omitted".
 *
 * Pass null for a gated viewer: the caller must skip the query entirely rather
 * than compute and then blank, and this makes that path explicit.
 */
export function foldConditionBuckets(
  rows: Array<{ condition: string; ride?: { durationSeconds: number } | null }> | null,
  onUnknownCondition?: (condition: string) => void
): ConditionBucket[] {
  const buckets = new Map<string, ConditionBucket>(
    emptyConditionBuckets().map((b) => [b.condition, b])
  );

  for (const row of rows ?? []) {
    const bucket = buckets.get(row.condition);
    // Runtime guard rather than a bare cast: if a migration adds a
    // WeatherCondition value before this is updated, we want it to surface
    // rather than vanish silently into a miscount.
    if (!bucket) {
      onUnknownCondition?.(row.condition);
      continue;
    }
    bucket.rideCount += 1;
    bucket.durationSeconds += row.ride?.durationSeconds ?? 0;
  }

  return WEATHER_CONDITIONS.map((c) => buckets.get(c)!);
}

/** One component's half-open stay [start, end) on one bike. */
export interface ComponentWindow {
  componentId: string;
  start: Date;
  end: Date;
}

/**
 * Every component's tenure windows on one bike, across every part ever
 * installed there, as (componentId, start, end) triples.
 *
 * This is the bike-side view of the same tenure rule normalizeTenures applies
 * per component: each component's rows are normalized on their own (so open
 * rows close at retirement and a component that claims the bike without an
 * install row gets its synthetic tenure), then only the stays on this bike are
 * kept. mergeWindows is deliberately not used: it coalesces by bike alone and
 * would fold different components' windows into one, losing the componentId
 * that service attribution needs.
 *
 * Used to attribute service logs to a bike by when they happened rather than
 * by Component.bikeId, so services on parts since replaced, moved to another
 * bike or retired stay in this bike's history and cost.
 */
export async function componentWindowsForBike(
  db: PrismaClient | Prisma.TransactionClient,
  bikeId: string,
  userId: string,
  now: Date = new Date()
): Promise<ComponentWindow[]> {
  const rows = await db.bikeComponentInstall.findMany({
    where: { bikeId, userId },
    select: { id: true, bikeId: true, slotKey: true, installedAt: true, removedAt: true, componentId: true },
    orderBy: { installedAt: 'asc' },
    take: TENURE_CAP * 5,
  });
  const componentIds = new Set(rows.map((r) => r.componentId));
  const components = await db.component.findMany({
    where: {
      userId,
      OR: [{ id: { in: [...componentIds] } }, { bikeId }],
    },
    select: {
      id: true,
      userId: true,
      bikeId: true,
      installedAt: true,
      createdAt: true,
      retiredAt: true,
      hoursUsed: true,
    },
  });

  const rowsByComponent = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = rowsByComponent.get(row.componentId);
    if (list) list.push(row);
    else rowsByComponent.set(row.componentId, [row]);
  }

  const windows: ComponentWindow[] = [];
  for (const component of components) {
    // A component's rows on OTHER bikes matter to normalizeTenures only for the
    // drift repair, which looks at rows on component.bikeId. When that is this
    // bike, the rows we fetched are exactly the relevant ones.
    const { tenures } = normalizeTenures(component, rowsByComponent.get(component.id) ?? [], now);
    for (const t of tenures) {
      if (t.bikeId !== bikeId) continue;
      windows.push({ componentId: component.id, start: t.start, end: t.end });
    }
  }
  return windows;
}

/**
 * Prisma predicate selecting the service logs performed inside any of the
 * windows: one indexable branch per window on (componentId, performedAt).
 * Returns null when there are no windows, so callers skip the query.
 */
export function serviceLogWhereForWindows(
  windows: ComponentWindow[]
): Prisma.ServiceLogWhereInput | null {
  if (windows.length === 0) return null;
  return {
    OR: windows.map((w) => ({
      componentId: w.componentId,
      performedAt: { gte: w.start, lt: w.end },
    })),
  };
}

/** The window (if any) that contains the moment, for attributing one log to a bike. */
export function windowContaining<T extends ComponentWindow>(
  windows: T[],
  componentId: string,
  at: Date
): T | null {
  for (const w of windows) {
    if (w.componentId === componentId && at >= w.start && at < w.end) return w;
  }
  return null;
}
