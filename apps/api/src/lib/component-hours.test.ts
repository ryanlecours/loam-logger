import {
  loadComponentAttribution,
  computeCountedHours,
  recomputeComponentHours,
  recomputeAdjustedComponentsForRides,
  findAdjustedComponentIdsForRides,
  type ComponentAttribution,
} from './component-hours';
import type { Prisma } from '@prisma/client';

// Minimal mock transaction client covering the models these helpers touch.
const makeTx = () => ({
  component: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  serviceLog: {
    findFirst: jest.fn(),
  },
  componentRideAdjustment: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  ride: {
    aggregate: jest.fn().mockResolvedValue({ _sum: { durationSeconds: 0 }, _count: 0 }),
  },
});
type MockTx = ReturnType<typeof makeTx>;
const asTx = (tx: MockTx) => tx as unknown as Prisma.TransactionClient;

const BASE_COMPONENT = {
  id: 'comp-1',
  userId: 'user-1',
  bikeId: 'bike-1',
  installedAt: null as Date | null,
  hoursUsed: 10,
};

const attribution = (over: Partial<ComponentAttribution> = {}): ComponentAttribution => ({
  component: { ...BASE_COMPONENT },
  anchor: null,
  excludedRideIds: [],
  includedRideIds: [],
  ...over,
});

describe('loadComponentAttribution', () => {
  it('returns null for a missing component', async () => {
    const tx = makeTx();
    tx.component.findUnique.mockResolvedValue(null);

    expect(await loadComponentAttribution(asTx(tx), 'nope')).toBeNull();
    expect(tx.serviceLog.findFirst).not.toHaveBeenCalled();
  });

  it('anchors on the latest service log when one exists', async () => {
    const tx = makeTx();
    const logDate = new Date('2026-06-01T00:00:00Z');
    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT, installedAt: new Date('2026-01-01') });
    tx.serviceLog.findFirst.mockResolvedValue({ performedAt: logDate });

    const result = await loadComponentAttribution(asTx(tx), 'comp-1');

    expect(result?.anchor).toEqual(logDate);
    expect(tx.serviceLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { componentId: 'comp-1' },
        orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
      })
    );
  });

  it('falls back to installedAt, then null (all-time)', async () => {
    const tx = makeTx();
    const installedAt = new Date('2026-02-01T00:00:00Z');
    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT, installedAt });
    tx.serviceLog.findFirst.mockResolvedValue(null);

    expect((await loadComponentAttribution(asTx(tx), 'comp-1'))?.anchor).toEqual(installedAt);

    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT, installedAt: null });
    expect((await loadComponentAttribution(asTx(tx), 'comp-1'))?.anchor).toBeNull();
  });

  it('splits adjustments into excluded and included ride ids', async () => {
    const tx = makeTx();
    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT });
    tx.serviceLog.findFirst.mockResolvedValue(null);
    tx.componentRideAdjustment.findMany.mockResolvedValue([
      { rideId: 'r-ex', kind: 'EXCLUDE' },
      { rideId: 'r-in', kind: 'INCLUDE' },
    ]);

    const result = await loadComponentAttribution(asTx(tx), 'comp-1');

    expect(result?.excludedRideIds).toEqual(['r-ex']);
    expect(result?.includedRideIds).toEqual(['r-in']);
  });
});

describe('computeCountedHours', () => {
  it('sums the on-bike window excluding EXCLUDEd rides and duplicates', async () => {
    const tx = makeTx();
    const anchor = new Date('2026-06-01T00:00:00Z');
    tx.ride.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 7200 }, _count: 2 });

    const result = await computeCountedHours(
      asTx(tx),
      attribution({ anchor, excludedRideIds: ['r-ex'] })
    );

    expect(result).toEqual({ hours: 2, rideCount: 2 });
    expect(tx.ride.aggregate).toHaveBeenCalledTimes(1);
    expect(tx.ride.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          bikeId: 'bike-1',
          isDuplicate: false,
          startTime: { gte: anchor },
          id: { notIn: ['r-ex'] },
        },
      })
    );
  });

  it('adds INCLUDEd cross-bike rides, guarding against stale-INCLUDE double count', async () => {
    const tx = makeTx();
    tx.ride.aggregate
      .mockResolvedValueOnce({ _sum: { durationSeconds: 3600 }, _count: 1 }) // on-bike
      .mockResolvedValueOnce({ _sum: { durationSeconds: 1800 }, _count: 1 }); // include

    const result = await computeCountedHours(asTx(tx), attribution({ includedRideIds: ['r-in'] }));

    expect(result).toEqual({ hours: 1.5, rideCount: 2 });
    // Include branch must exclude the component's own bike (a stale INCLUDE
    // on a ride that later moved onto this bike already counts on-bike).
    expect(tx.ride.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['r-in'] },
          isDuplicate: false,
          NOT: { bikeId: 'bike-1' },
        }),
      })
    );
  });

  it('handles spare components (no bike): include branch only, no NOT clause', async () => {
    const tx = makeTx();
    tx.ride.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 5400 }, _count: 3 });

    const result = await computeCountedHours(
      asTx(tx),
      attribution({
        component: { ...BASE_COMPONENT, bikeId: null },
        includedRideIds: ['r1', 'r2', 'r3'],
      })
    );

    expect(result).toEqual({ hours: 1.5, rideCount: 3 });
    expect(tx.ride.aggregate).toHaveBeenCalledTimes(1);
    const where = tx.ride.aggregate.mock.calls[0][0].where;
    expect(where.NOT).toBeUndefined();
    expect(where.id).toEqual({ in: ['r1', 'r2', 'r3'] });
  });

  it('applies the anchor window to the INCLUDE branch (pre-anchor INCLUDEs dormant)', async () => {
    const tx = makeTx();
    const anchor = new Date('2026-06-01T00:00:00Z');
    tx.ride.aggregate
      .mockResolvedValueOnce({ _sum: { durationSeconds: 0 }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { durationSeconds: 0 }, _count: 0 });

    await computeCountedHours(asTx(tx), attribution({ anchor, includedRideIds: ['r-in'] }));

    expect(tx.ride.aggregate.mock.calls[1][0].where.startTime).toEqual({ gte: anchor });
  });

  it('returns zero for a spare with no included rides without querying', async () => {
    const tx = makeTx();
    const result = await computeCountedHours(
      asTx(tx),
      attribution({ component: { ...BASE_COMPONENT, bikeId: null } })
    );

    expect(result).toEqual({ hours: 0, rideCount: 0 });
    expect(tx.ride.aggregate).not.toHaveBeenCalled();
  });
});

describe('recomputeComponentHours', () => {
  it('persists the canonical value and returns it with the attribution used', async () => {
    const tx = makeTx();
    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT });
    tx.serviceLog.findFirst.mockResolvedValue(null);
    tx.ride.aggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 9000 }, _count: 2 });

    const result = await recomputeComponentHours(asTx(tx), 'comp-1');

    expect(result?.hours).toBe(2.5);
    // Attribution is returned so callers (e.g. the adjustment mutations'
    // counted flag) don't re-run the same reads.
    expect(result?.attribution.component.id).toBe('comp-1');
    expect(result?.attribution.anchor).toBeNull();
    expect(tx.component.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { hoursUsed: 2.5 },
    });
  });

  it('no-ops and returns null for a missing component', async () => {
    const tx = makeTx();
    tx.component.findUnique.mockResolvedValue(null);

    expect(await recomputeComponentHours(asTx(tx), 'gone')).toBeNull();
    expect(tx.component.update).not.toHaveBeenCalled();
  });
});

describe('recomputeAdjustedComponentsForRides', () => {
  it('resolves components from rideIds and returns distinct affected bikeIds', async () => {
    const tx = makeTx();
    tx.componentRideAdjustment.findMany.mockResolvedValueOnce([
      { componentId: 'comp-a' },
      { componentId: 'comp-b' },
    ]);
    tx.component.findUnique
      .mockResolvedValueOnce({ ...BASE_COMPONENT, id: 'comp-a', bikeId: 'bike-1' })
      .mockResolvedValueOnce({ ...BASE_COMPONENT, id: 'comp-b', bikeId: null }); // spare
    tx.serviceLog.findFirst.mockResolvedValue(null);
    // comp-a on-bike aggregate; comp-b has no bike and no includes -> no query
    tx.ride.aggregate.mockResolvedValue({ _sum: { durationSeconds: 3600 }, _count: 1 });
    // Per-component adjustment loads (inside loadComponentAttribution)
    tx.componentRideAdjustment.findMany.mockResolvedValue([]);

    const bikeIds = await recomputeAdjustedComponentsForRides(asTx(tx), { rideIds: ['r-1'] });

    expect(bikeIds).toEqual(['bike-1']); // spare contributes no bikeId
    expect(tx.component.update).toHaveBeenCalledTimes(2);
  });

  it('accepts pre-captured componentIds (ride-delete path) without querying adjustments', async () => {
    const tx = makeTx();
    tx.component.findUnique.mockResolvedValue({ ...BASE_COMPONENT });
    tx.serviceLog.findFirst.mockResolvedValue(null);

    await recomputeAdjustedComponentsForRides(asTx(tx), { componentIds: ['comp-1'] });

    expect(tx.component.update).toHaveBeenCalledTimes(1);
  });

  it('returns empty for no inputs', async () => {
    const tx = makeTx();
    expect(await recomputeAdjustedComponentsForRides(asTx(tx), {})).toEqual([]);
    expect(tx.component.update).not.toHaveBeenCalled();
  });
});

describe('findAdjustedComponentIdsForRides', () => {
  it('returns distinct componentIds referencing the rides', async () => {
    const tx = makeTx();
    tx.componentRideAdjustment.findMany.mockResolvedValue([
      { componentId: 'comp-a' },
      { componentId: 'comp-b' },
    ]);

    expect(await findAdjustedComponentIdsForRides(asTx(tx), ['r-1', 'r-2'])).toEqual([
      'comp-a',
      'comp-b',
    ]);
    expect(tx.componentRideAdjustment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rideId: { in: ['r-1', 'r-2'] } }, distinct: ['componentId'] })
    );
  });

  it('short-circuits on empty input', async () => {
    const tx = makeTx();
    expect(await findAdjustedComponentIdsForRides(asTx(tx), [])).toEqual([]);
    expect(tx.componentRideAdjustment.findMany).not.toHaveBeenCalled();
  });
});
