import {
  bikeCostSummary,
  componentCostSummary,
  pickCurrency,
  sumServiceSpend,
} from './cost-summary';

const d = (iso: string) => new Date(iso);
const NOW = d('2026-10-30T00:00:00Z');

// A minimal fake of the Prisma surface the summaries touch. Each test states
// its rows; the helpers under test do the arithmetic.
type Fake = {
  installs: Array<{ id: string; bikeId: string; componentId: string; slotKey: string; installedAt: Date; removedAt: Date | null }>;
  components: Array<{
    id: string;
    userId: string;
    bikeId: string | null;
    installedAt: Date | null;
    createdAt: Date;
    retiredAt: Date | null;
    hoursUsed: number;
    isStock: boolean;
    purchasePriceMinor: number | null;
    purchaseCurrency: string | null;
  }>;
  logs: Array<{ componentId: string; kind: 'SERVICE' | 'INSPECTION'; performedAt: Date; costMinor: number | null; currency: string | null }>;
  rideSeconds: number;
};

function fakeDb(f: Fake) {
  return {
    bikeComponentInstall: {
      findMany: jest.fn(async ({ where }: { where: { bikeId: string } }) =>
        f.installs.filter((i) => i.bikeId === where.bikeId)
      ),
    },
    component: {
      findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] }; OR?: Array<{ id?: { in: string[] }; bikeId?: string }> } }) => {
        if (where.id?.in) return f.components.filter((c) => where.id!.in.includes(c.id));
        const ids = new Set<string>();
        for (const branch of where.OR ?? []) {
          if (branch.id?.in) branch.id.in.forEach((id) => ids.add(id));
          if (branch.bikeId) f.components.filter((c) => c.bikeId === branch.bikeId).forEach((c) => ids.add(c.id));
        }
        return f.components.filter((c) => ids.has(c.id));
      }),
    },
    serviceLog: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // componentCostSummary filters by componentId; bikeCostSummary by windows.
        const componentId = (where as { componentId?: string }).componentId;
        if (componentId) {
          return f.logs.filter((l) => l.componentId === componentId && l.kind === 'SERVICE' && l.costMinor != null);
        }
        const and = (where as { AND: Array<{ OR?: Array<{ componentId: string; performedAt: { gte: Date; lt: Date } }> }> }).AND;
        const branches = and[0].OR ?? [];
        return f.logs.filter(
          (l) =>
            l.kind === 'SERVICE' &&
            l.costMinor != null &&
            branches.some((b) => b.componentId === l.componentId && l.performedAt >= b.performedAt.gte && l.performedAt < b.performedAt.lt)
        );
      }),
    },
    ride: {
      aggregate: jest.fn(async () => ({ _sum: { durationSeconds: f.rideSeconds } })),
    },
  } as unknown as Parameters<typeof bikeCostSummary>[0];
}

describe('pickCurrency', () => {
  it('prefers the rider setting, then the first amount seen, then USD', () => {
    expect(pickCurrency('EUR', ['CAD'])).toBe('EUR');
    expect(pickCurrency(null, [null, 'CAD', 'USD'])).toBe('CAD');
    expect(pickCurrency(undefined, [])).toBe('USD');
  });
});

describe('sumServiceSpend', () => {
  it('is null when nothing recorded a cost', () => {
    expect(sumServiceSpend([{ costMinor: null, currency: null }], 'USD')).toEqual({
      spendMinor: null,
      spendCurrency: null,
      spendOtherCurrencyCount: 0,
    });
  });

  it('sums one currency and counts the others instead of converting', () => {
    expect(
      sumServiceSpend(
        [
          { costMinor: 8500, currency: 'USD' },
          { costMinor: 1200, currency: 'USD' },
          { costMinor: 9900, currency: 'EUR' },
          { costMinor: null, currency: null },
        ],
        'USD'
      )
    ).toEqual({ spendMinor: 9700, spendCurrency: 'USD', spendOtherCurrencyCount: 1 });
  });
});

describe('componentCostSummary', () => {
  const base = {
    id: 'fork',
    purchasePriceMinor: 110000,
    purchaseCurrency: 'USD',
    lifetimeHours: 220,
    hoursUsed: 40,
    priorHours: 0,
    countersComputedAt: NOW,
  };

  it('adds purchase and service spend and divides by lifetime hours', async () => {
    const db = fakeDb({
      installs: [],
      components: [],
      logs: [
        { componentId: 'fork', kind: 'SERVICE', performedAt: d('2026-03-01T00:00:00Z'), costMinor: 8500, currency: 'USD' },
        { componentId: 'fork', kind: 'INSPECTION', performedAt: d('2026-05-01T00:00:00Z'), costMinor: null, currency: null },
      ],
      rideSeconds: 0,
    });
    const s = await componentCostSummary(db, base, 'USD');
    expect(s).toMatchObject({
      currency: 'USD',
      purchaseMinor: 110000,
      serviceMinor: 8500,
      totalMinor: 118500,
      lifetimeHours: 220,
      otherCurrencyCount: 0,
    });
    expect(s.perHourMinor).toBeCloseTo(118500 / 220, 5);
  });

  it('leaves a foreign-currency purchase out and says so', async () => {
    const db = fakeDb({ installs: [], components: [], logs: [], rideSeconds: 0 });
    const s = await componentCostSummary(db, { ...base, purchaseCurrency: 'EUR' }, 'USD');
    expect(s.purchaseMinor).toBeNull();
    expect(s.totalMinor).toBe(0);
    expect(s.otherCurrencyCount).toBe(1);
  });

  it('gives no per-hour figure under an hour and falls back to legacy hours', async () => {
    const db = fakeDb({ installs: [], components: [], logs: [], rideSeconds: 0 });
    const s = await componentCostSummary(
      db,
      { ...base, countersComputedAt: null, lifetimeHours: 0, hoursUsed: 0.5, priorHours: 0 },
      'USD'
    );
    expect(s.lifetimeHours).toBe(0.5);
    expect(s.perHourMinor).toBeNull();
  });
});

describe('bikeCostSummary', () => {
  const bike = { id: 'bike-1', userId: 'u1', purchasePriceMinor: 450000, purchaseCurrency: 'USD' };
  const component = (over: Partial<Fake['components'][number]>): Fake['components'][number] => ({
    id: 'c',
    userId: 'u1',
    bikeId: 'bike-1',
    installedAt: d('2025-01-01T00:00:00Z'),
    createdAt: d('2025-01-01T00:00:00Z'),
    retiredAt: null,
    hoursUsed: 0,
    isStock: false,
    purchasePriceMinor: null,
    purchaseCurrency: null,
    ...over,
  });

  it('attributes services by tenure, counts bought parts once, and ignores stock parts', async () => {
    const db = fakeDb({
      installs: [
        // The original chain: on the bike all of 2025, then replaced.
        { id: 'i1', bikeId: 'bike-1', componentId: 'chain-old', slotKey: 'CHAIN_NONE', installedAt: d('2025-01-01T00:00:00Z'), removedAt: d('2026-01-01T00:00:00Z') },
        // Its replacement, bought for $60.
        { id: 'i2', bikeId: 'bike-1', componentId: 'chain-new', slotKey: 'CHAIN_NONE', installedAt: d('2026-01-01T00:00:00Z'), removedAt: null },
        // A stock fork: its price is the bike's.
        { id: 'i3', bikeId: 'bike-1', componentId: 'fork', slotKey: 'FORK_NONE', installedAt: d('2025-01-01T00:00:00Z'), removedAt: null },
      ],
      components: [
        component({ id: 'chain-old', bikeId: null, retiredAt: d('2026-01-01T00:00:00Z') }),
        component({ id: 'chain-new', installedAt: d('2026-01-01T00:00:00Z'), purchasePriceMinor: 6000, purchaseCurrency: 'USD' }),
        component({ id: 'fork', isStock: true, purchasePriceMinor: 99999, purchaseCurrency: 'USD' }),
      ],
      logs: [
        // Waxed the old chain while it was on this bike: counts, in 2025.
        { componentId: 'chain-old', kind: 'SERVICE', performedAt: d('2025-06-01T00:00:00Z'), costMinor: 1500, currency: 'USD' },
        // A service on the old chain after it came off: not this bike's.
        { componentId: 'chain-old', kind: 'SERVICE', performedAt: d('2026-02-01T00:00:00Z'), costMinor: 99999, currency: 'USD' },
        // Fork service in euros: counted, not converted.
        { componentId: 'fork', kind: 'SERVICE', performedAt: d('2026-03-01T00:00:00Z'), costMinor: 9000, currency: 'EUR' },
        // Fork service in dollars.
        { componentId: 'fork', kind: 'SERVICE', performedAt: d('2026-04-01T00:00:00Z'), costMinor: 12000, currency: 'USD' },
      ],
      rideSeconds: 100 * 3600,
    });

    const s = await bikeCostSummary(db, bike, 'USD', NOW);
    expect(s.currency).toBe('USD');
    expect(s.bikeMinor).toBe(450000);
    expect(s.partsMinor).toBe(6000);
    expect(s.serviceMinor).toBe(1500 + 12000);
    expect(s.totalMinor).toBe(450000 + 6000 + 13500);
    expect(s.rideHours).toBe(100);
    expect(s.perHourMinor).toBeCloseTo((450000 + 6000 + 13500) / 100, 5);
    expect(s.otherCurrencyCount).toBe(1);
    expect(s.byYear).toEqual([
      { year: 2026, partsMinor: 6000, serviceMinor: 12000 },
      { year: 2025, partsMinor: 0, serviceMinor: 1500 },
    ]);
  });

  it('is all zeros with no per-hour figure for a bike with no parts or rides', async () => {
    const db = fakeDb({ installs: [], components: [], logs: [], rideSeconds: 0 });
    const s = await bikeCostSummary(db, { ...bike, purchasePriceMinor: null, purchaseCurrency: null }, null, NOW);
    expect(s).toMatchObject({ currency: 'USD', bikeMinor: null, partsMinor: 0, serviceMinor: 0, totalMinor: 0, rideHours: 0, perHourMinor: null, byYear: [], otherCurrencyCount: 0 });
  });
});
