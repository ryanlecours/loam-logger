import {
  computeComponentCounters,
  recomputeComponentCounters,
  creditRideToComponents,
  lifetimeHoursAt,
} from './component-counters';
import { logger } from './logger';
import {
  computeCountedHours,
  recomputeAdjustedComponentsForRides,
  type ComponentAttribution,
} from './component-hours';
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

type Log = {
  id: string;
  kind: 'SERVICE' | 'INSPECTION';
  performedAt: Date;
  createdAt: Date;
  hoursAtService: number;
  hoursAtServiceDeclared: boolean;
};

const makeTx = (opts: {
  rides?: Ride[];
  component?: Record<string, unknown> | null;
  /** The component's own install rows (the recompute's tenure read). */
  installs?: Array<Record<string, unknown>>;
  adjustments?: Array<{ rideId: string; kind: string }>;
  /** Canned latest-log answers, for tests that do not need a logbook. */
  latestService?: { hoursAtService: number } | null;
  latestInspection?: { hoursAtService: number } | null;
  /**
   * A stateful logbook. When given, latest-log reads, the reading refresh and
   * its writes all go through it, so a refreshed reading feeds the counters.
   */
  logs?: Log[];
  /** Per-ride credit: every install row on the bike, and the computed candidates. */
  bikeInstalls?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
}) => {
  const rides = opts.rides ?? [];
  const logs = opts.logs;
  const newestFirst = (a: Log, b: Log) =>
    b.performedAt.getTime() - a.performedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime();
  return {
    // The recompute's row lock (SELECT ... FOR UPDATE) and the debit's floor pass.
    $executeRaw: jest.fn().mockResolvedValue(1),
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
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(opts.candidates ?? []),
    },
    bikeComponentInstall: {
      // Keyed by shape: the recompute asks per component, the credit per bike.
      findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.componentId ? opts.installs ?? [] : opts.bikeInstalls ?? []
      ),
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
      // The reading refresh's single read: counted rides in start order.
      findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        rides
          .filter((r) => matches(r, where))
          .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
          .map((r) => ({ startTime: r.startTime, durationSeconds: r.durationSeconds }))
      ),
    },
    serviceLog: {
      // Honors the direction asked for: the refresh reads oldest first, the
      // per-ride credit newest first.
      findMany: jest.fn().mockImplementation(
        async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Array<Record<string, string>> }) => {
          const hit = (logs ?? []).filter(
            (l) => where.hoursAtServiceDeclared === undefined || l.hoursAtServiceDeclared === where.hoursAtServiceDeclared
          );
          const sorted = [...hit].sort(newestFirst);
          return orderBy?.[0]?.performedAt === 'asc' ? sorted.reverse() : sorted;
        }
      ),
      update: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { hoursAtService: number } }) => {
        const log = logs?.find((l) => l.id === where.id);
        if (log) log.hoursAtService = data.hoursAtService;
        return log ?? {};
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      // Distinguishes the two reads by which kinds they ask for.
      // A read with no kind filter (the service anchor) takes the newest log.
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: { kind?: { in: string[] } } }) => {
        const kinds = where.kind?.in ?? ['SERVICE', 'INSPECTION'];
        if (logs) return [...logs].sort(newestFirst).find((l) => kinds.includes(l.kind)) ?? null;
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

const log = (id: string, iso: string, hoursAtService: number, extra: Partial<Log> = {}): Log => ({
  id,
  kind: 'SERVICE',
  performedAt: d(iso),
  createdAt: d(iso),
  hoursAtService,
  hoursAtServiceDeclared: false,
  ...extra,
});

describe('service readings in a recompute', () => {
  // The regression behind "derive unless declared". A service logged on 1 Apr
  // with 10h on the fork; a Strava history import then brings in a 5h ride
  // from March. That ride happened BEFORE the service, so hours since service
  // must not move. A stored reading of 10 would leave it counted as since.
  it('keeps a ride imported after the service, but dated before it, out of "since service"', async () => {
    const book = [log('svc', '2025-04-01T00:00:00Z', 10)];
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [
        ride('feb', 'bike-1', '2025-02-01T00:00:00Z', 10),
        ride('mar-import', 'bike-1', '2025-03-01T00:00:00Z', 5),
        ride('may', 'bike-1', '2025-05-01T00:00:00Z', 2),
      ],
      logs: book,
    });

    const c = await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(book[0].hoursAtService).toBe(15);
    expect(c).toEqual({ lifetimeHours: 17, hoursSinceService: 2, hoursSinceInspection: 2 });
  });

  // A rider's "serviced at 300h" for a pre-Loam service is their statement and
  // nothing in the ledger can check it, so the refresh never asks for it.
  it('only re-derives readings the rider did not declare', async () => {
    const tx = makeTx({ installs: [OPEN_TENURE], logs: [] });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(tx.serviceLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { componentId: 'comp-1', hoursAtServiceDeclared: false } })
    );
  });

  it('keeps a declared reading as given', async () => {
    const book = [log('pre-loam', '2025-01-01T00:00:00Z', 300, { hoursAtServiceDeclared: true })];
    const tx = makeTx({
      component: {
        id: 'comp-1', userId: 'user-1', bikeId: 'bike-1',
        installedAt: d('2025-01-01T00:00:00Z'), createdAt: d('2025-01-01T00:00:00Z'),
        retiredAt: null, hoursUsed: 0, priorHours: 320,
      },
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 5)],
      logs: book,
    });

    const c = await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(book[0].hoursAtService).toBe(300);
    expect(tx.serviceLog.update).not.toHaveBeenCalled();
    expect(c?.hoursSinceService).toBe(25);
  });

  it('writes nothing when a derived reading is already right', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 4)],
      logs: [log('svc', '2025-03-01T00:00:00Z', 4)],
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(tx.serviceLog.update).not.toHaveBeenCalled();
  });

  // Pre-migration rows held the since-service figure, not a lifetime reading.
  // They are not declared, so the same refresh moves them onto the new scale:
  // here a second service that used to read "50h since the first".
  it('moves pre-migration readings onto the lifetime scale', async () => {
    const book = [log('first', '2025-02-01T00:00:00Z', 0), log('second', '2025-06-01T00:00:00Z', 50)];
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [
        ride('a', 'bike-1', '2025-01-15T00:00:00Z', 50),
        ride('b', 'bike-1', '2025-04-01T00:00:00Z', 50),
        ride('c', 'bike-1', '2025-07-01T00:00:00Z', 10),
      ],
      logs: book,
    });

    const c = await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(book.map((l) => l.hoursAtService)).toEqual([50, 100]);
    expect(c?.hoursSinceService).toBe(10);
  });

  it('builds the counted-ride predicate once, however many readings it refreshes', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      logs: [
        log('a', '2025-02-01T00:00:00Z', 9),
        log('b', '2025-03-01T00:00:00Z', 9),
        log('c', '2025-04-01T00:00:00Z', 9),
      ],
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    // One tenure read, shared by the refresh and the counter derivation.
    expect(tx.bikeComponentInstall.findMany).toHaveBeenCalledTimes(1);
    expect(tx.component.findUnique).toHaveBeenCalledTimes(1);
  });

  // The guard the review asked for: the refresh must not cost a query per log.
  // The bulk paths recompute every part on a bike while holding row locks.
  it('reads rides once for every reading, however many logs there are', async () => {
    const book = Array.from({ length: 12 }, (_, i) =>
      log(`l${i}`, `2025-${String(i + 1).padStart(2, '0')}-15T00:00:00Z`, 0)
    );
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: Array.from({ length: 12 }, (_, i) =>
        ride(`r${i}`, 'bike-1', `2025-${String(i + 1).padStart(2, '0')}-01T00:00:00Z`, 1)
      ),
      logs: book,
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(tx.ride.findMany).toHaveBeenCalledTimes(1);
    // The only aggregate left is the lifetime total.
    expect(tx.ride.aggregate).toHaveBeenCalledTimes(1);
    // Each log reads the rides strictly before it: one ride per month so far.
    expect(book.map((l) => l.hoursAtService)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('skips the ride read when there is nothing to refresh', async () => {
    const tx = makeTx({ installs: [OPEN_TENURE], rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z')], logs: [] });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    expect(tx.ride.findMany).not.toHaveBeenCalled();
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

  // Readings must be fresh before the subtraction reads them, or a stale one
  // (an old-scale row, or one a later import has outdated) is what the
  // counters get derived from.
  it('refreshes readings before deriving the counters', async () => {
    const tx = makeTx({
      installs: [OPEN_TENURE],
      rides: [ride('r1', 'bike-1', '2025-02-01T00:00:00Z', 40)],
      logs: [log('svc', '2025-03-01T00:00:00Z', 7)],
    });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    const refreshedAt = tx.serviceLog.update.mock.invocationCallOrder[0];
    const firstLatestRead = Math.min(...tx.serviceLog.findFirst.mock.invocationCallOrder);
    expect(refreshedAt).toBeLessThan(firstLatestRead);
  });

  // A recompute reads the ledger and then writes absolute values, so a
  // concurrent ride increment landing in between would be overwritten. The
  // row lock must be taken before the first ledger read, not just before the
  // write.
  it('locks the component row before reading anything', async () => {
    const tx = makeTx({ installs: [OPEN_TENURE], logs: [] });

    await recomputeComponentCounters(asTx(tx), 'comp-1');

    const [strings, id] = tx.$executeRaw.mock.calls[0];
    expect((strings as string[]).join('?')).toMatch(/FROM "Component" WHERE "id" = \? FOR UPDATE/);
    expect(id).toBe('comp-1');
    const lockedAt = tx.$executeRaw.mock.invocationCallOrder[0];
    const firstRead = Math.min(
      ...tx.component.findUnique.mock.invocationCallOrder,
      ...tx.serviceLog.findMany.mock.invocationCallOrder
    );
    expect(lockedAt).toBeLessThan(firstRead);
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

  // The pass that runs after a ride edit or delete for every part with an
  // adjustment on the touched ride. It used to write hoursUsed from the old
  // anchored rule straight over the new counters, so this fork went back to
  // 205h (the 210h overcount, less the excluded ride) while hoursSinceService
  // still said 25h. Now it is the full recompute, and the two agree.
  it('keeps hoursUsed in lockstep when an adjusted ride is touched', async () => {
    const tx = makeTx({
      component,
      installs: tenures,
      rides,
      // The fork's own correction: s0 was ridden on a borrowed fork.
      adjustments: [{ rideId: 's0', kind: 'EXCLUDE', componentId: 'comp-1' } as never],
      // Serviced 1 Jan 2026 while on Bike A, before any ride it carried.
      logs: [log('svc', '2026-01-01T00:00:00Z', 0)],
    });

    const bikeIds = await recomputeAdjustedComponentsForRides(asTx(tx), { rideIds: ['s0'] });

    const [{ data }] = tx.component.update.mock.calls.at(-1)!;
    // 20h on Bike A + s1 on Bike B; s0 excluded.
    expect(data.lifetimeHours).toBe(25);
    expect(data.hoursUsed).toBe(data.hoursSinceService);
    expect(data.hoursUsed).toBe(25);
    expect(data.countersComputedAt).toEqual(expect.any(Date));
    // The recompute took the row lock first.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.component.update.mock.invocationCallOrder[0]
    );
    expect(bikeIds).toEqual(['B_B']);
  });
});

// The per-ride fast path must land exactly where a recompute would. Each case
// is a ride the old "every part on the bike" increment got wrong.
describe('creditRideToComponents', () => {
  const part = (id: string, bikeId: string | null, installedIso: string) => ({
    id,
    userId: 'user-1',
    bikeId,
    installedAt: d(installedIso),
    createdAt: d(installedIso),
    retiredAt: null,
    hoursUsed: 0,
  });
  const tenure = (id: string, componentId: string, fromIso: string, toIso: string | null = null) => ({
    id,
    componentId,
    bikeId: 'bike-1',
    slotKey: 'FORK_NONE',
    installedAt: d(fromIso),
    removedAt: toIso ? d(toIso) : null,
  });
  const credit = (tx: MockTx, iso: string, hoursDelta = 2) =>
    creditRideToComponents(asTx(tx), { userId: 'user-1', bikeId: 'bike-1', startTime: d(iso), hoursDelta });
  const floorStatements = (tx: MockTx) =>
    tx.$executeRaw.mock.calls
      .map(([strings]) => (strings as string[]).join('?'))
      .filter((sql) => !sql.includes('FOR UPDATE'));
  const updateFor = (tx: MockTx, id: string) =>
    tx.component.updateMany.mock.calls
      .map(([arg]) => arg)
      .find((arg) => (arg.where.id?.in ?? []).includes(id));

  it('skips a part fitted after the ride', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'old-fork', '2025-01-01T00:00:00Z'), tenure('t2', 'new-shock', '2025-06-01T00:00:00Z')],
      candidates: [part('old-fork', 'bike-1', '2025-01-01T00:00:00Z'), part('new-shock', 'bike-1', '2025-06-01T00:00:00Z')],
    });

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'old-fork')).toBeDefined();
    expect(updateFor(tx, 'new-shock')).toBeUndefined();
  });

  it('credits a part that was on the bike then, even though it has moved since', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'moved-fork', '2025-01-01T00:00:00Z', '2025-05-01T00:00:00Z')],
      candidates: [part('moved-fork', 'bike-2', '2025-01-01T00:00:00Z')],
    });

    const bikeIds = await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'moved-fork')).toBeDefined();
    // Its new bike's predictions read its counters too.
    expect(bikeIds).toEqual(expect.arrayContaining(['bike-1', 'bike-2']));
  });

  it('counts a ride before the latest derived service toward lifetime only', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
      logs: [{ ...log('svc', '2025-04-01T00:00:00Z', 10), id: 'svc' }],
    });
    tx.serviceLog.findMany.mockResolvedValue([
      { componentId: 'fork', kind: 'SERVICE', performedAt: d('2025-04-01T00:00:00Z'), hoursAtServiceDeclared: false },
    ]);

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'fork')?.data).toEqual({ lifetimeHours: { increment: 2 } });
    // The service's reading moves with lifetime, so the subtraction holds.
    expect(tx.serviceLog.updateMany).toHaveBeenCalledWith({
      where: {
        componentId: { in: ['fork'] },
        hoursAtServiceDeclared: false,
        performedAt: { gt: d('2025-03-01T00:00:00Z') },
      },
      data: { hoursAtService: { increment: 2 } },
    });
  });

  it('counts a ride after the latest service toward every counter', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });
    tx.serviceLog.findMany.mockResolvedValue([
      { componentId: 'fork', kind: 'SERVICE', performedAt: d('2025-02-01T00:00:00Z'), hoursAtServiceDeclared: false },
    ]);

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'fork')?.data).toEqual({
      lifetimeHours: { increment: 2 },
      hoursSinceService: { increment: 2 },
      hoursUsed: { increment: 2 },
      hoursSinceInspection: { increment: 2 },
    });
  });

  // A declared reading does not move with lifetime, so a ride before it still
  // widens the gap: since = lifetime - declared.
  it('moves "since" for a ride before a declared service', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });
    tx.serviceLog.findMany.mockResolvedValue([
      { componentId: 'fork', kind: 'SERVICE', performedAt: d('2025-04-01T00:00:00Z'), hoursAtServiceDeclared: true },
    ]);

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'fork')?.data).toMatchObject({ hoursSinceService: { increment: 2 } });
  });

  it('lets an inspection after the ride hold only the inspection clock', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });
    tx.serviceLog.findMany.mockResolvedValue([
      { componentId: 'fork', kind: 'INSPECTION', performedAt: d('2025-04-01T00:00:00Z'), hoursAtServiceDeclared: false },
      { componentId: 'fork', kind: 'SERVICE', performedAt: d('2025-02-01T00:00:00Z'), hoursAtServiceDeclared: false },
    ]);

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(updateFor(tx, 'fork')?.data).toEqual({
      lifetimeHours: { increment: 2 },
      hoursSinceService: { increment: 2 },
      hoursUsed: { increment: 2 },
    });
  });

  it('gives parts with uncomputed counters only the legacy hoursUsed change', async () => {
    const tx = makeTx({});

    await credit(tx, '2025-03-01T00:00:00Z');

    expect(tx.component.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', bikeId: 'bike-1', countersComputedAt: null },
      data: { hoursUsed: { increment: 2 } },
    });
    // The candidate read asks for computed rows only.
    expect(tx.component.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ countersComputedAt: { not: null } }) })
    );
  });

  // Independent floors could leave hoursSinceService above lifetimeHours when
  // only lifetimeHours was clamped. The cap keeps the invariant without waiting
  // for the next recompute, and only on computed rows: an uncomputed row's
  // lifetimeHours is 0, and capping its legacy hoursUsed to that would wipe it.
  it('floors and caps the debited parts after a debit', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });

    await credit(tx, '2025-03-01T00:00:00Z', -2);

    const statements = floorStatements(tx);
    expect(statements).toHaveLength(2);
    for (const sql of statements) {
      expect(sql).toContain('"lifetimeHours" = GREATEST("lifetimeHours", 0)');
      for (const column of ['hoursUsed', 'hoursSinceService', 'hoursSinceInspection']) {
        expect(sql).toContain(
          `"${column}" = CASE WHEN "countersComputedAt" IS NULL THEN GREATEST("${column}", 0)`
        );
      }
      expect(sql.match(/LEAST\(GREATEST\("\w+", 0\), GREATEST\("lifetimeHours", 0\)\)/g)).toHaveLength(3);
    }
  });

  it('logs when a debit had to clamp a counter', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });
    // Legacy floor clamps nothing; the covering part's floor clamps one row.
    // The candidates' row lock is not a floor, so it does not take a turn.
    let floors = 0;
    tx.$executeRaw.mockImplementation(async (strings: string[]) =>
      strings.join('?').includes('FOR UPDATE') ? 1 : floors++ === 0 ? 0 : 1
    );

    await credit(tx, '2025-03-01T00:00:00Z', -2);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ bikeId: 'bike-1', componentIds: ['fork'], clamped: 1 }),
      expect.stringContaining('under-report')
    );
    warn.mockRestore();
  });

  it('does not floor anything after a credit', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });

    await credit(tx, '2025-03-01T00:00:00Z', 2);

    expect(floorStatements(tx)).toHaveLength(0);
  });

  // Whether a ride moves a "since" counter depends on the part's tenures and
  // latest logs. Reading them before taking the row locks let a concurrent
  // service write change them in between, so the credit could disagree with
  // the recompute that wrote the counters.
  it('locks the candidates, in id order, before reading tenures or logs', async () => {
    const tx = makeTx({
      bikeInstalls: [tenure('t1', 'fork', '2025-01-01T00:00:00Z')],
      candidates: [part('fork', 'bike-1', '2025-01-01T00:00:00Z')],
    });

    await credit(tx, '2025-03-01T00:00:00Z');

    const lockAt = tx.$executeRaw.mock.calls.findIndex(([strings]) =>
      (strings as string[]).join('?').includes('FOR UPDATE')
    );
    expect(lockAt).toBeGreaterThanOrEqual(0);
    const [strings, ...values] = tx.$executeRaw.mock.calls[lockAt];
    const sql = (strings as string[]).join('?');
    expect(sql).toMatch(/"countersComputedAt" IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY "id" COLLATE "C"\s+FOR UPDATE/);
    expect(values).toEqual(['user-1', 'bike-1', 'user-1', 'bike-1']);

    const lockedAt = tx.$executeRaw.mock.invocationCallOrder[lockAt];
    expect(lockedAt).toBeLessThan(tx.bikeComponentInstall.findMany.mock.invocationCallOrder[0]);
    expect(lockedAt).toBeLessThan(tx.component.findMany.mock.invocationCallOrder[0]);
    expect(lockedAt).toBeLessThan(tx.serviceLog.findMany.mock.invocationCallOrder[0]);
  });
});
