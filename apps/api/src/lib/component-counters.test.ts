import {
  computeComponentCounters,
  recomputeComponentCounters,
  rescaleLegacyServiceLogs,
  setLegacyArchiveDropped,
  lifetimeHoursAt,
} from './component-counters';
import { logger } from './logger';
import { computeCountedHours, type ComponentAttribution } from './component-hours';
import type { Prisma } from '@prisma/client';

const d = (iso: string) => new Date(iso);

type Ride = {
  id: string;
  userId: string;
  bikeId: string | null;
  startTime: Date;
  durationSeconds: number;
  isDuplicate: boolean;
};

/**
 * Where-matcher covering the clauses these code paths emit, so ride.aggregate
 * actually filters instead of returning a canned total. Without it the
 * date-bounded and tenure-bounded assertions below would be vacuous.
 */
const matches = (r: Ride, w: Record<string, unknown>): boolean => {
  if (!w) return true;
  if (w.AND) return (w.AND as Record<string, unknown>[]).every((c) => matches(r, c));
  if (w.userId && r.userId !== w.userId) return false;
  if (w.isDuplicate !== undefined && r.isDuplicate !== w.isDuplicate) return false;
  const id = w.id as { in?: string[]; notIn?: string[] } | undefined;
  if (id?.notIn && id.notIn.includes(r.id)) return false;
  if (id?.in && !id.in.includes(r.id)) return false;
  if (w.bikeId !== undefined && r.bikeId !== w.bikeId) return false;
  const st = w.startTime as { gte?: Date; lt?: Date } | undefined;
  if (st?.gte && r.startTime < st.gte) return false;
  if (st?.lt && r.startTime >= st.lt) return false;
  if (w.OR) {
    return (w.OR as Record<string, unknown>[]).some((b) =>
      matches(r, { ...b, userId: w.userId, isDuplicate: w.isDuplicate, id: w.id })
    );
  }
  return true;
};

const makeTx = (opts: {
  rides?: Ride[];
  component?: Record<string, unknown> | null;
  installs?: Array<Record<string, unknown>>;
  adjustments?: Array<{ rideId: string; kind: string }>;
  /** Latest log per kind-set, keyed by the first kind in the query's `in`. */
  latestService?: { hoursAtService: number } | null;
  latestInspection?: { hoursAtService: number } | null;
  /**
   * The migration's ServiceLog archive. Absent by default (the post-cleanup
   * state); `legacyLogs` are the rows still on the old scale.
   */
  archive?: { legacyLogs: Array<{ id: string; performedAt: Date }> };
}) => {
  const rides = opts.rides ?? [];
  return {
    // Two raw reads: the archive-existence probe, then the legacy-row select.
    $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string) =>
      sql.includes('to_regclass')
        ? [{ present: opts.archive !== undefined }]
        : opts.archive?.legacyLogs ?? []
    ),
    component: {
      findUnique: jest.fn().mockResolvedValue(
        opts.component === undefined
          ? {
              id: 'comp-1',
              userId: 'user-1',
              bikeId: 'bike-1',
              installedAt: d('2025-01-01T00:00:00Z'),
              createdAt: d('2025-01-01T00:00:00Z'),
              retiredAt: null,
              hoursUsed: 0,
              priorHours: 0,
            }
          : opts.component
      ),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    bikeComponentInstall: {
      findMany: jest.fn().mockResolvedValue(opts.installs ?? []),
    },
    componentRideAdjustment: {
      findMany: jest.fn().mockResolvedValue(opts.adjustments ?? []),
    },
    ride: {
      aggregate: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        const hit = rides.filter((r) => matches(r, where));
        return {
          _sum: { durationSeconds: hit.reduce((sum, r) => sum + r.durationSeconds, 0) },
          _count: hit.length,
        };
      }),
    },
    serviceLog: {
      update: jest.fn().mockResolvedValue({}),
      // Distinguishes the two reads by which kinds they ask for.
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: { kind: { in: string[] } } }) => {
        const kinds = where.kind.in;
        return kinds.includes('INSPECTION')
          ? opts.latestInspection ?? null
          : opts.latestService ?? null;
      }),
    },
  };
};
type MockTx = ReturnType<typeof makeTx>;
const asTx = (tx: MockTx) => tx as unknown as Prisma.TransactionClient;

const H = 3600;
const ride = (id: string, bikeId: string | null, iso: string, hours = 1): Ride => ({
  id,
  userId: 'user-1',
  bikeId,
  startTime: d(iso),
  durationSeconds: hours * H,
  isDuplicate: false,
});

const OPEN_TENURE = {
  id: 'inst-1',
  bikeId: 'bike-1',
  slotKey: 'FORK_NONE',
  installedAt: d('2025-01-01T00:00:00Z'),
  removedAt: null,
};

// The "archive dropped" answer is cached per process; each test starts unknown.
beforeEach(() => setLegacyArchiveDropped(false));

describe('computeComponentCounters', () => {
  it('sums lifetime hours from the tenure ledger', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 2), ride('r2', 'bike-1', '2025-03-01T00:00:00Z', 3)],
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.lifetimeHours).toBe(5);
  });

  it('includes declared prior hours in the lifetime figure', async () => {
    // The used-wheels case: hours accrued before Loam Logger existed for the
    // part, which no amount of ride data can reconstruct.
    const tx = makeTx({
      component: {
        id: 'comp-1', userId: 'user-1', bikeId: 'bike-1',
        installedAt: d('2025-01-01T00:00:00Z'), createdAt: d('2025-01-01T00:00:00Z'),
        retiredAt: null, hoursUsed: 0, priorHours: 200,
      },
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 10)],
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.lifetimeHours).toBe(210);
    // Never serviced, so the whole lifetime counts against the service clock —
    // an unserviced used part really is carrying that wear.
    expect(c?.hoursSinceService).toBe(210);
  });

  it('derives hoursSinceService by subtracting the log lifetime reading', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 50)],
      latestService: { hoursAtService: 30 },
      latestInspection: { hoursAtService: 30 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.lifetimeHours).toBe(50);
    expect(c?.hoursSinceService).toBe(20);
  });

  it('treats a service as resetting the inspection clock too', async () => {
    // You cannot service a part without looking at it.
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 40)],
      latestService: { hoursAtService: 10 },
      latestInspection: { hoursAtService: 10 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.hoursSinceService).toBe(30);
    expect(c?.hoursSinceInspection).toBe(30);
  });

  it('lets an inspection reset only the inspection clock', async () => {
    // A rider who spins a hub and finds it fine has inspected, not serviced.
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 40)],
      latestService: { hoursAtService: 10 },
      latestInspection: { hoursAtService: 35 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.hoursSinceService).toBe(30);
    expect(c?.hoursSinceInspection).toBe(5);
  });

  it('counts everything when no log has ever reset a clock', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 12)],
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c).toEqual({ lifetimeHours: 12, hoursSinceService: 12, hoursSinceInspection: 12 });
  });

  it('clamps a since-figure at zero rather than reporting negative hours', async () => {
    // hoursAtService for a pre-Loam service is user-declared and can exceed
    // what we can derive. Negative "hours since" is never a truthful answer.
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 5)],
      latestService: { hoursAtService: 999 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.hoursSinceService).toBe(0);
  });

  it('attributes nothing for a component with no tenures', async () => {
    const tx = makeTx({
      component: {
        id: 'comp-1', userId: 'user-1', bikeId: null, installedAt: null,
        createdAt: d('2025-01-01T00:00:00Z'), retiredAt: null, hoursUsed: 0, priorHours: 0,
      },
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 99)],
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c?.lifetimeHours).toBe(0);
  });

  it('returns null for a missing component', async () => {
    const tx = makeTx({ component: null });
    expect(await computeComponentCounters(asTx(tx), 'gone')).toBeNull();
  });
  it('clamps a service reading above lifetime to zero and logs it', async () => {
    // Rides deleted after the service was recorded: the reading now exceeds
    // what the ledger can derive. Zero is the only truthful "since", but the
    // inconsistency is worth a log line rather than silence.
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 10)],
      latestService: { hoursAtService: 30 },
      latestInspection: { hoursAtService: 30 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');

    expect(c?.hoursSinceService).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: 'comp-1', hoursAtService: 30, lifetimeHours: 10 }),
      expect.any(String)
    );
    warn.mockRestore();
  });

  it('never lets a "since" figure exceed lifetime, whatever the reading', async () => {
    // Float error in a stored reading must not break hoursSince* <= lifetime.
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 10)],
      latestService: { hoursAtService: -1e-9 },
      latestInspection: { hoursAtService: -1e-9 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');

    expect(c?.hoursSinceService).toBe(10);
    expect(c?.hoursSinceInspection).toBe(10);
  });
});

describe('rescaleLegacyServiceLogs', () => {
  it('rewrites each legacy log to the lifetime reading at its date', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [
        ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 4),
        ride('r2', 'bike-1', '2025-06-01T00:00:00Z', 6),
      ],
      archive: {
        legacyLogs: [
          { id: 'log-1', performedAt: d('2025-04-01T00:00:00Z') },
          { id: 'log-2', performedAt: d('2025-12-01T00:00:00Z') },
        ],
      },
    });

    expect(await rescaleLegacyServiceLogs(asTx(tx), 'comp-1')).toBe(2);
    expect(tx.serviceLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { hoursAtService: 4 },
    });
    expect(tx.serviceLog.update).toHaveBeenCalledWith({
      where: { id: 'log-2' },
      data: { hoursAtService: 10 },
    });
  });

  it('scopes the legacy select to the component, as a bound parameter', async () => {
    const tx = makeTx({ archive: { legacyLogs: [] } });

    await rescaleLegacyServiceLogs(asTx(tx), 'comp-1');

    const select = tx.$queryRawUnsafe.mock.calls.find(([sql]) => !String(sql).includes('to_regclass'));
    expect(select?.[0]).toContain('"updatedAt" = a."updatedAt"');
    expect(select?.slice(1)).toEqual(['comp-1']);
  });

  it('does nothing once the archive is gone, and stops asking', async () => {
    const tx = makeTx({});

    expect(await rescaleLegacyServiceLogs(asTx(tx), 'comp-1')).toBe(0);
    expect(await rescaleLegacyServiceLogs(asTx(tx), 'comp-2')).toBe(0);

    // One existence probe, then the cached answer.
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(tx.serviceLog.update).not.toHaveBeenCalled();
  });
});


describe('lifetimeHoursAt', () => {
  it('counts only rides before the given moment', async () => {
    // This is what keeps a backdated service log honest: its lifetime reading
    // must be as of the service date, not as of now.
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [
        ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 4),
        ride('r2', 'bike-1', '2025-06-01T00:00:00Z', 6),
      ],
    });

    expect(await lifetimeHoursAt(asTx(tx), 'comp-1', d('2025-04-01T00:00:00Z'))).toBe(4);
    expect(await lifetimeHoursAt(asTx(tx), 'comp-1', d('2025-12-01T00:00:00Z'))).toBe(10);
  });

  it('includes prior hours at any date', async () => {
    const tx = makeTx({
      component: {
        id: 'comp-1', userId: 'user-1', bikeId: 'bike-1',
        installedAt: d('2025-01-01T00:00:00Z'), createdAt: d('2025-01-01T00:00:00Z'),
        retiredAt: null, hoursUsed: 0, priorHours: 50,
      },
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 4)],
    });

    expect(await lifetimeHoursAt(asTx(tx), 'comp-1', d('2025-01-15T00:00:00Z'))).toBe(50);
  });
});

describe('recomputeComponentCounters', () => {
  it('persists all three counters and keeps hoursUsed in lockstep', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 40)],
      latestService: { hoursAtService: 15 },
      latestInspection: { hoursAtService: 15 },
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    // hoursUsed is what every existing reader still consumes, so it tracks
    // hoursSinceService rather than requiring a big-bang client migration.
    expect(tx.component.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: {
        lifetimeHours: 40,
        hoursSinceService: 25,
        hoursSinceInspection: 25,
        hoursUsed: 25,
        countersComputedAt: expect.any(Date),
      },
    });
  });

  // The deploy-to-backfill window: a ride sync or service write recomputes a
  // part whose logs are still on the old scale. Rescaling first is what stops
  // it subtracting an old-scale reading from a lifetime figure.
  it('rescales legacy logs before deriving the counters', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 40)],
      archive: { legacyLogs: [{ id: 'log-1', performedAt: d('2025-03-01T00:00:00Z') }] },
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    const rescaledAt = tx.serviceLog.update.mock.invocationCallOrder[0];
    const firstLatestRead = Math.min(...tx.serviceLog.findFirst.mock.invocationCallOrder);
    expect(rescaledAt).toBeLessThan(firstLatestRead);
  });
});

// The regression that motivated this whole model. Reproduces the exact fixture
// that previously charged a fork 210 hours it had never been ridden for.
describe('regression: a component moved between bikes', () => {
  // Fork serviced 1 Jan while on Bike A (ridden lightly), moved to Bike B (the
  // rider's main bike, ridden hard all year) on 1 Sep.
  const rides: Ride[] = [
    ...Array.from({ length: 4 }, (_, i) => ride(`a${i}`, 'B_A', `2026-0${2 + i}-10T00:00:00Z`, 5)),
    ...Array.from({ length: 40 }, (_, i) =>
      ride(`b${i}`, 'B_B', new Date(Date.UTC(2026, 0, 5 + i * 5)).toISOString(), 5)),
    ride('s0', 'B_B', '2026-09-10T00:00:00Z', 5),
    ride('s1', 'B_B', '2026-09-20T00:00:00Z', 5),
  ];

  const tenures = [
    { id: 't1', bikeId: 'B_A', slotKey: 'FORK_NONE', installedAt: d('2025-01-01T00:00:00Z'), removedAt: d('2026-09-01T00:00:00Z') },
    { id: 't2', bikeId: 'B_B', slotKey: 'FORK_NONE', installedAt: d('2026-09-01T00:00:00Z'), removedAt: null },
  ];

  const component = {
    id: 'comp-1', userId: 'user-1', bikeId: 'B_B',
    installedAt: d('2026-09-01T00:00:00Z'), createdAt: d('2025-01-01T00:00:00Z'),
    retiredAt: null, hoursUsed: 0, priorHours: 0,
  };

  it('counts only the hours it was actually fitted for', async () => {
    const tx = makeTx({ component, installs: tenures, rides });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    // 20h on Bike A (4 rides) + 10h on Bike B since the swap (2 rides).
    expect(c?.lifetimeHours).toBe(30);
  });

  it('never reports more hours since service than the part has lived', async () => {
    // The invariant the old model could violate. It holds structurally here
    // because both "since" counters are subtractions from lifetimeHours.
    const tx = makeTx({
      component,
      installs: tenures,
      rides,
      latestService: { hoursAtService: 12 },
      latestInspection: { hoursAtService: 12 },
    });

    const c = await computeComponentCounters(asTx(tx), 'comp-1');
    expect(c!.hoursSinceService).toBeLessThanOrEqual(c!.lifetimeHours);
    expect(c!.hoursSinceInspection).toBeLessThanOrEqual(c!.lifetimeHours);
    expect(c!.hoursSinceService).toBe(18);
  });

  it('beats the old bikeId-anchored rule, which overcounted 7x', async () => {
    // Documents the size of the bug rather than just its absence: the old rule
    // paired the component's CURRENT bike with its OLD anchor and had no tenure
    // bound, so it swept up Bike B's entire season.
    const tx = makeTx({ component, installs: tenures, rides });

    const legacy: ComponentAttribution = {
      component: { id: 'comp-1', userId: 'user-1', bikeId: 'B_B', installedAt: component.installedAt, hoursUsed: 0 },
      anchor: d('2026-01-01T00:00:00Z'),
      excludedRideIds: [],
      includedRideIds: [],
    };
    const legacyHours = (await computeCountedHours(asTx(tx), legacy)).hours;
    const counters = await computeComponentCounters(asTx(tx), 'comp-1');

    expect(legacyHours).toBe(210);
    expect(counters?.lifetimeHours).toBe(30);
    expect(legacyHours / counters!.lifetimeHours).toBe(7);
  });
});
