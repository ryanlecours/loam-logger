import {
  normalizeTenures,
  mergeWindows,
  buildCountedRideWhere,
  aggregateLifetime,
  emptyConditionBuckets,
  foldConditionBuckets,
  WEATHER_CONDITIONS,
  TENURE_CAP,
  type HistoryComponent,
  type NormalizedTenure,
} from './component-history';
import type { Prisma } from '@prisma/client';

const d = (iso: string) => new Date(iso);
const NOW = d('2026-09-01T00:00:00Z');

const component = (over: Partial<HistoryComponent> = {}): HistoryComponent => ({
  id: 'comp-1',
  userId: 'user-1',
  bikeId: 'bike-1',
  installedAt: d('2024-01-01T00:00:00Z'),
  createdAt: d('2024-01-01T00:00:00Z'),
  retiredAt: null,
  hoursUsed: 10,
  ...over,
});

const row = (over: Partial<{
  id: string;
  bikeId: string;
  slotKey: string;
  installedAt: Date;
  removedAt: Date | null;
}> = {}) => ({
  id: 'inst-1',
  bikeId: 'bike-1',
  slotKey: 'FORK_NONE',
  installedAt: d('2024-01-01T00:00:00Z'),
  removedAt: null as Date | null,
  ...over,
});

describe('normalizeTenures', () => {
  it('reads a simple open tenure and reports FULL coverage', () => {
    const res = normalizeTenures(component(), [row()], NOW);

    expect(res.coverage).toBe('FULL');
    expect(res.driftDetected).toBe(false);
    expect(res.historyIncomplete).toBe(false);
    expect(res.tenures).toHaveLength(1);
    expect(res.tenures[0].end).toEqual(NOW);
    expect(res.tenures[0].removedAt).toBeNull();
    expect(res.tenures[0].synthetic).toBe(false);
  });

  it('stops an unclosed tenure at retiredAt rather than running to now', () => {
    // The orphan sweep retires a Component without closing its install row;
    // `?? now` alone would accrue the old bike's rides forever.
    const retiredAt = d('2025-06-01T00:00:00Z');
    const res = normalizeTenures(component({ retiredAt, bikeId: null }), [row()], NOW);

    expect(res.tenures).toHaveLength(1);
    expect(res.tenures[0].end).toEqual(retiredAt);
  });

  it('drops a zero-length tenure and flags the history as incomplete', () => {
    // updateBikeComponentInstall's guard is `<`, so removedAt == installedAt
    // is legal and would otherwise emit an always-false query branch.
    const at = d('2024-05-01T00:00:00Z');
    const res = normalizeTenures(
      component({ bikeId: null }),
      [row({ installedAt: at, removedAt: at })],
      NOW
    );

    expect(res.tenures).toHaveLength(0);
    expect(res.historyIncomplete).toBe(true);
  });

  it('drops an inverted tenure', () => {
    const res = normalizeTenures(
      component({ bikeId: null }),
      [row({ installedAt: d('2024-05-01T00:00:00Z'), removedAt: d('2024-01-01T00:00:00Z') })],
      NOW
    );

    expect(res.tenures).toHaveLength(0);
    expect(res.historyIncomplete).toBe(true);
  });

  it('synthesizes a trailing tenure when bikeId has no open install row', () => {
    // Drift direction B: hoursUsed keeps growing via the bulk increment path
    // while lifetime would otherwise stop, showing hoursUsed > lifetime.
    const res = normalizeTenures(
      component({ bikeId: 'bike-2' }),
      [row({ removedAt: d('2025-01-01T00:00:00Z') })],
      NOW
    );

    expect(res.driftDetected).toBe(true);
    const synthetic = res.tenures.filter((t) => t.synthetic);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].bikeId).toBe('bike-2');
    expect(synthetic[0].end).toEqual(NOW);
  });

  it('starts a synthesized tenure after the last real one on the same bike', () => {
    const lastEnd = d('2025-01-01T00:00:00Z');
    const res = normalizeTenures(
      component({ bikeId: 'bike-1' }),
      [row({ removedAt: lastEnd })],
      NOW
    );

    const synthetic = res.tenures.find((t) => t.synthetic)!;
    expect(synthetic.start).toEqual(lastEnd);
  });

  it('falls back to component columns when there are no install rows', () => {
    const res = normalizeTenures(component(), [], NOW);

    expect(res.coverage).toBe('SYNTHETIC_FALLBACK');
    expect(res.tenures).toHaveLength(1);
    expect(res.tenures[0].synthetic).toBe(true);
    expect(res.tenures[0].start).toEqual(d('2024-01-01T00:00:00Z'));
  });

  it('reports NO_TENURE_DATA for an inventory component', () => {
    // INVENTORY and RETIRED components have bikeId AND installedAt nulled, so
    // there is genuinely nothing attributable — which must not read as zeros.
    const res = normalizeTenures(
      component({ bikeId: null, installedAt: null }),
      [],
      NOW
    );

    expect(res.coverage).toBe('NO_TENURE_DATA');
    expect(res.tenures).toHaveLength(0);
  });

  it('flags history as incomplete when the tenure cap is hit', () => {
    const rows = Array.from({ length: TENURE_CAP }, (_, i) =>
      row({
        id: `inst-${i}`,
        installedAt: d(`2020-01-01T00:00:00Z`),
        removedAt: d(`2020-02-01T00:00:00Z`),
      })
    );
    const res = normalizeTenures(component({ bikeId: null }), rows, NOW);

    expect(res.historyIncomplete).toBe(true);
  });

  it('orders tenures oldest first', () => {
    const res = normalizeTenures(
      component({ bikeId: null }),
      [
        row({ id: 'b', installedAt: d('2025-01-01T00:00:00Z'), removedAt: d('2025-06-01T00:00:00Z') }),
        row({ id: 'a', installedAt: d('2024-01-01T00:00:00Z'), removedAt: d('2024-06-01T00:00:00Z') }),
      ],
      NOW
    );

    expect(res.tenures.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('mergeWindows', () => {
  const tenure = (over: Partial<NormalizedTenure>): NormalizedTenure => ({
    id: 't',
    bikeId: 'bike-1',
    slotKey: 'FORK_NONE',
    start: d('2024-01-01T00:00:00Z'),
    end: d('2024-06-01T00:00:00Z'),
    removedAt: null,
    synthetic: false,
    ...over,
  });

  it('coalesces overlapping tenures on the same bike', () => {
    // Reachable: the partial unique index only constrains open rows, and the
    // install-editing mutations validate within a single row only.
    const merged = mergeWindows([
      tenure({ id: 'a', start: d('2024-01-01T00:00:00Z'), end: d('2024-06-01T00:00:00Z') }),
      tenure({ id: 'b', start: d('2024-03-01T00:00:00Z'), end: d('2024-09-01T00:00:00Z') }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].start).toEqual(d('2024-01-01T00:00:00Z'));
    expect(merged[0].end).toEqual(d('2024-09-01T00:00:00Z'));
  });

  it('keeps disjoint tenures separate', () => {
    const merged = mergeWindows([
      tenure({ id: 'a', start: d('2024-01-01T00:00:00Z'), end: d('2024-02-01T00:00:00Z') }),
      tenure({ id: 'b', start: d('2024-06-01T00:00:00Z'), end: d('2024-07-01T00:00:00Z') }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('does not merge across different bikes', () => {
    const merged = mergeWindows([
      tenure({ id: 'a', bikeId: 'bike-1' }),
      tenure({ id: 'b', bikeId: 'bike-2' }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('swallows a tenure fully contained in another', () => {
    const merged = mergeWindows([
      tenure({ id: 'a', start: d('2024-01-01T00:00:00Z'), end: d('2024-12-01T00:00:00Z') }),
      tenure({ id: 'b', start: d('2024-03-01T00:00:00Z'), end: d('2024-04-01T00:00:00Z') }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].end).toEqual(d('2024-12-01T00:00:00Z'));
  });
});

describe('buildCountedRideWhere', () => {
  it('returns null when nothing is attributable', () => {
    expect(
      buildCountedRideWhere({
        userId: 'user-1',
        windows: [],
        includedRideIds: [],
        excludedRideIds: [],
      })
    ).toBeNull();
  });

  it('builds half-open window branches', () => {
    // Half-open is mandatory: every swap writes removedAt(old) and
    // installedAt(new) from one shared `now`, so a closed interval would
    // credit the swap-instant ride to both components.
    const where = buildCountedRideWhere({
      userId: 'user-1',
      windows: [{ bikeId: 'bike-1', start: d('2024-01-01T00:00:00Z'), end: d('2024-06-01T00:00:00Z') }],
      includedRideIds: [],
      excludedRideIds: [],
    })!;

    expect(where.OR).toEqual([
      {
        bikeId: 'bike-1',
        startTime: { gte: d('2024-01-01T00:00:00Z'), lt: d('2024-06-01T00:00:00Z') },
      },
    ]);
    expect(where.isDuplicate).toBe(false);
  });

  it('adds an INCLUDE branch and an EXCLUDE filter', () => {
    const where = buildCountedRideWhere({
      userId: 'user-1',
      windows: [],
      includedRideIds: ['ride-in'],
      excludedRideIds: ['ride-out'],
    })!;

    expect(where.OR).toEqual([{ id: { in: ['ride-in'] } }]);
    expect(where.id).toEqual({ notIn: ['ride-out'] });
  });
});

describe('aggregateLifetime', () => {
  const makeTx = (rides: unknown[]) => ({
    ride: { findMany: jest.fn().mockResolvedValue(rides) },
  });
  const asTx = (tx: ReturnType<typeof makeTx>) => tx as unknown as Prisma.TransactionClient;

  const ride = (over: Record<string, unknown> = {}) => ({
    id: 'ride-1',
    bikeId: 'bike-1',
    startTime: d('2024-03-01T00:00:00Z'),
    durationSeconds: 3600,
    distanceMeters: 10000,
    elevationGainMeters: 500,
    ...over,
  });

  const tenures: NormalizedTenure[] = [
    {
      id: 'a',
      bikeId: 'bike-1',
      slotKey: 'FORK_NONE',
      start: d('2024-01-01T00:00:00Z'),
      end: d('2024-06-01T00:00:00Z'),
      removedAt: d('2024-06-01T00:00:00Z'),
      synthetic: false,
    },
    {
      id: 'b',
      bikeId: 'bike-2',
      slotKey: 'FORK_NONE',
      start: d('2024-06-01T00:00:00Z'),
      end: d('2025-01-01T00:00:00Z'),
      removedAt: d('2025-01-01T00:00:00Z'),
      synthetic: false,
    },
  ];

  it('splits rides across tenures and sums to the lifetime total', async () => {
    const tx = makeTx([
      ride({ id: 'r1', bikeId: 'bike-1', startTime: d('2024-02-01T00:00:00Z') }),
      ride({ id: 'r2', bikeId: 'bike-1', startTime: d('2024-03-01T00:00:00Z') }),
      ride({ id: 'r3', bikeId: 'bike-2', startTime: d('2024-08-01T00:00:00Z') }),
    ]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures,
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(res.perTenure.get('a')!.rideCount).toBe(2);
    expect(res.perTenure.get('b')!.rideCount).toBe(1);
    expect(res.lifetime.rideCount).toBe(3);
    // The invariant riders actually check by adding up the tenure cards.
    const summed =
      res.perTenure.get('a')!.rideCount +
      res.perTenure.get('b')!.rideCount +
      res.adjustments.rideCount;
    expect(summed).toBe(res.lifetime.rideCount);
  });

  // The since-service tab used to come from the old rule: every ride on the
  // part's CURRENT bike back to the newest log of any kind, with no tenure
  // bound. It now folds the same tenure-bounded rows from the latest service.
  describe('since-service window', () => {
    const rides = [
      ride({ id: 'r1', bikeId: 'bike-1', startTime: d('2024-02-01T00:00:00Z'), distanceMeters: 1000 }),
      ride({ id: 'r2', bikeId: 'bike-1', startTime: d('2024-03-01T00:00:00Z'), distanceMeters: 2000 }),
      ride({ id: 'r3', bikeId: 'bike-2', startTime: d('2024-08-01T00:00:00Z'), distanceMeters: 4000 }),
    ];

    it('counts only rides on or after the latest service, across tenures', async () => {
      const res = await aggregateLifetime(asTx(makeTx(rides)), {
        userId: 'user-1',
        tenures,
        includedRideIds: [],
        excludedRideIds: [],
        sinceServiceAt: d('2024-03-01T00:00:00Z'),
      });

      // r2 is on the service date itself: the reading counts rides strictly
      // before, so a ride at that moment is "since". r3 is on the next bike.
      expect(res.sinceService.rideCount).toBe(2);
      expect(res.sinceService.distanceMeters).toBe(6000);
      expect(res.sinceService.firstRideAt).toEqual(d('2024-03-01T00:00:00Z'));
      expect(res.sinceService.lastRideAt).toEqual(d('2024-08-01T00:00:00Z'));
      expect(res.lifetime.rideCount).toBe(3);
    });

    it('is the whole lifetime when the part was never serviced', async () => {
      const res = await aggregateLifetime(asTx(makeTx(rides)), {
        userId: 'user-1',
        tenures,
        includedRideIds: [],
        excludedRideIds: [],
        sinceServiceAt: null,
      });

      expect(res.sinceService).toEqual(res.lifetime);
    });

    it('costs no extra query', async () => {
      const tx = makeTx(rides);

      await aggregateLifetime(asTx(tx), {
        userId: 'user-1',
        tenures,
        includedRideIds: [],
        excludedRideIds: [],
        sinceServiceAt: d('2024-03-01T00:00:00Z'),
      });

      expect(tx.ride.findMany).toHaveBeenCalledTimes(1);
    });
  });

  it('credits a swap-instant ride to exactly one tenure', async () => {
    // The outgoing tenure ends and the incoming one starts at the same
    // timestamp; half-open windows mean the incoming component gets it.
    const tx = makeTx([
      ride({ id: 'r1', bikeId: 'bike-2', startTime: d('2024-06-01T00:00:00Z') }),
    ]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures,
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(res.perTenure.get('a')!.rideCount).toBe(0);
    expect(res.perTenure.get('b')!.rideCount).toBe(1);
    expect(res.lifetime.rideCount).toBe(1);
  });

  it('does not double-count a ride matching two overlapping tenures', async () => {
    const overlapping: NormalizedTenure[] = [
      { ...tenures[0], id: 'a' },
      { ...tenures[0], id: 'a2', start: d('2024-02-01T00:00:00Z'), end: d('2024-09-01T00:00:00Z') },
    ];
    const tx = makeTx([ride({ id: 'r1', startTime: d('2024-03-01T00:00:00Z') })]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures: overlapping,
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(res.lifetime.rideCount).toBe(1);
    expect(res.perTenure.get('a')!.rideCount).toBe(1);
    expect(res.perTenure.get('a2')!.rideCount).toBe(0);
  });

  it('puts an out-of-window INCLUDE ride in the adjustments bucket', async () => {
    const tx = makeTx([
      ride({ id: 'r-inc', bikeId: 'bike-9', startTime: d('2023-01-01T00:00:00Z') }),
    ]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures,
      includedRideIds: ['r-inc'],
      excludedRideIds: [],
    });

    expect(res.adjustments.rideCount).toBe(1);
    expect(res.lifetime.rideCount).toBe(1);
    expect(res.perTenure.get('a')!.rideCount).toBe(0);
  });

  it('sums raw distance, elevation and duration', async () => {
    const tx = makeTx([
      ride({ id: 'r1', durationSeconds: 3600, distanceMeters: 1000, elevationGainMeters: 100 }),
      ride({ id: 'r2', durationSeconds: 1800, distanceMeters: 500, elevationGainMeters: 50 }),
    ]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures,
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(res.lifetime.durationSeconds).toBe(5400);
    expect(res.lifetime.distanceMeters).toBe(1500);
    expect(res.lifetime.elevationGainMeters).toBe(150);
  });

  it('tracks first and last ride dates', async () => {
    const tx = makeTx([
      ride({ id: 'r1', startTime: d('2024-02-01T00:00:00Z') }),
      ride({ id: 'r2', startTime: d('2024-05-01T00:00:00Z') }),
    ]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures,
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(res.lifetime.firstRideAt).toEqual(d('2024-02-01T00:00:00Z'));
    expect(res.lifetime.lastRideAt).toEqual(d('2024-05-01T00:00:00Z'));
  });

  it('skips the query entirely when nothing is attributable', async () => {
    const tx = makeTx([]);

    const res = await aggregateLifetime(asTx(tx), {
      userId: 'user-1',
      tenures: [],
      includedRideIds: [],
      excludedRideIds: [],
    });

    expect(tx.ride.findMany).not.toHaveBeenCalled();
    expect(res.rideWhere).toBeNull();
    expect(res.lifetime.rideCount).toBe(0);
  });
});

describe('condition buckets (Pro gate shape)', () => {
  it('returns one zeroed bucket per condition for a gated viewer', () => {
    const zeroed = emptyConditionBuckets();

    expect(zeroed).toHaveLength(WEATHER_CONDITIONS.length);
    expect(zeroed.every((b) => b.rideCount === 0 && b.durationSeconds === 0)).toBe(true);
  });

  it('gives a gated viewer exactly the shape real data has', () => {
    // The gate must be indistinguishable from "no rides had weather". If the
    // shapes differed, a client could detect the tier from the response.
    const gated = emptyConditionBuckets();
    const noWeather = foldConditionBuckets([]);

    expect(gated).toEqual(noWeather);
  });

  it('treats null rows as gated rather than as an empty result', () => {
    // null is the caller's signal that it skipped the query entirely, which is
    // what stops a free user's weather ever being read out of the database.
    expect(foldConditionBuckets(null)).toEqual(emptyConditionBuckets());
  });

  it('counts rides and sums durations per condition', () => {
    const buckets = foldConditionBuckets([
      { condition: 'RAINY', ride: { durationSeconds: 3600 } },
      { condition: 'RAINY', ride: { durationSeconds: 1800 } },
      { condition: 'SUNNY', ride: { durationSeconds: 7200 } },
    ]);

    const rainy = buckets.find((b) => b.condition === 'RAINY')!;
    expect(rainy.rideCount).toBe(2);
    expect(rainy.durationSeconds).toBe(5400);
    expect(buckets.find((b) => b.condition === 'SUNNY')!.rideCount).toBe(1);
  });

  it('zero-fills conditions that never occurred', () => {
    const buckets = foldConditionBuckets([{ condition: 'FOGGY', ride: { durationSeconds: 60 } }]);

    expect(buckets).toHaveLength(WEATHER_CONDITIONS.length);
    expect(buckets.find((b) => b.condition === 'SNOWY')).toEqual({
      condition: 'SNOWY',
      rideCount: 0,
      durationSeconds: 0,
    });
  });

  it('surfaces an unknown condition instead of silently miscounting it', () => {
    const seen: string[] = [];
    const buckets = foldConditionBuckets(
      [{ condition: 'HAIL', ride: { durationSeconds: 60 } }],
      (c) => seen.push(c)
    );

    expect(seen).toEqual(['HAIL']);
    expect(buckets.every((b) => b.rideCount === 0)).toBe(true);
  });

  it('tolerates a missing ride relation', () => {
    const buckets = foldConditionBuckets([{ condition: 'WINDY', ride: null }]);

    const windy = buckets.find((b) => b.condition === 'WINDY')!;
    expect(windy.rideCount).toBe(1);
    expect(windy.durationSeconds).toBe(0);
  });
});
