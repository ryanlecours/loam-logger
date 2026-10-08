import type { PrismaClient } from '@prisma/client';
import {
  buildSharedComponentHistory,
  componentStartDate,
  rangeError,
  shareWindow,
} from './component-share';
import { buildCountedRideWhere } from './component-history';

const d = (iso: string) => new Date(iso);
const NOW = d('2026-10-08T12:00:00Z');

describe('componentStartDate', () => {
  const component = { installedAt: d('2025-06-01T00:00:00Z'), createdAt: d('2025-05-01T00:00:00Z') };

  it('is the earliest tenure start', () => {
    const tenures = [{ start: d('2025-09-15T16:00:00Z') }, { start: d('2025-03-01T00:00:00Z') }];
    expect(componentStartDate(tenures, component)).toEqual(d('2025-03-01T00:00:00Z'));
  });

  it('falls back to installedAt, then createdAt', () => {
    expect(componentStartDate([], component)).toEqual(d('2025-06-01T00:00:00Z'));
    expect(componentStartDate([], { ...component, installedAt: null })).toEqual(d('2025-05-01T00:00:00Z'));
  });
});

describe('rangeError', () => {
  const startDate = d('2025-09-15T16:00:00Z');
  const check = (start: string, end: string) =>
    rangeError({ start: d(start), end: d(end), startDate, now: NOW });

  it('accepts a range inside the life of the part', () => {
    expect(check('2025-10-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBeNull();
  });

  // The picker sends local midnights, so the install day and today must pass
  // for a rider well away from UTC.
  it('allows a day of slack at both ends for time zones', () => {
    expect(check('2025-09-15T07:00:00Z', '2026-10-09T07:00:00Z')).toBeNull();
  });

  it('rejects a start before the install date', () => {
    expect(check('2025-09-01T00:00:00Z', '2026-01-01T00:00:00Z')).toMatch(/before the component was installed/);
  });

  it('rejects an end after today', () => {
    expect(check('2025-10-01T00:00:00Z', '2026-10-20T00:00:00Z')).toMatch(/after today/);
  });

  it('rejects an empty or reversed range, and invalid dates', () => {
    expect(check('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toMatch(/after the start/);
    expect(check('2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')).toMatch(/after the start/);
    expect(check('not a date', '2026-01-01T00:00:00Z')).toBe('Invalid date');
  });
});

describe('shareWindow', () => {
  const lastService = d('2026-08-01T12:00:00Z');

  it('is open at both ends for a lifetime link', () => {
    expect(shareWindow({ scope: 'LIFETIME', rangeStart: null, rangeEnd: null }, lastService)).toEqual({
      start: null,
      end: null,
    });
  });

  it('starts at the latest service for a since-service link, and stays open', () => {
    expect(shareWindow({ scope: 'SINCE_SERVICE', rangeStart: null, rangeEnd: null }, lastService)).toEqual({
      start: lastService,
      end: null,
    });
    // Never serviced: every ride counts, as on the owner's page.
    expect(shareWindow({ scope: 'SINCE_SERVICE', rangeStart: null, rangeEnd: null }, null)).toEqual({
      start: null,
      end: null,
    });
  });

  it('is the stored window for a range link', () => {
    const rangeStart = d('2026-01-01T08:00:00Z');
    const rangeEnd = d('2026-02-01T08:00:00Z');
    expect(shareWindow({ scope: 'RANGE', rangeStart, rangeEnd }, lastService)).toEqual({
      start: rangeStart,
      end: rangeEnd,
    });
  });
});

describe('buildCountedRideWhere with a range', () => {
  it('narrows every branch, the included rides too', () => {
    const where = buildCountedRideWhere({
      userId: 'user-1',
      windows: [{ bikeId: 'bike-1', start: d('2025-01-01T00:00:00Z'), end: NOW }],
      includedRideIds: ['ride-x'],
      excludedRideIds: [],
      range: { start: d('2026-01-01T00:00:00Z'), end: d('2026-02-01T00:00:00Z') },
    });
    expect(where).toMatchObject({
      startTime: { gte: d('2026-01-01T00:00:00Z'), lt: d('2026-02-01T00:00:00Z') },
    });
  });

  it('adds nothing for an open window', () => {
    const where = buildCountedRideWhere({
      userId: 'user-1',
      windows: [{ bikeId: 'bike-1', start: d('2025-01-01T00:00:00Z'), end: NOW }],
      includedRideIds: [],
      excludedRideIds: [],
      range: { start: null, end: null },
    });
    expect(where).not.toHaveProperty('startTime');
  });
});

describe('buildSharedComponentHistory', () => {
  const hubs = {
    id: 'comp-1',
    userId: 'user-1',
    bikeId: 'bike-1',
    type: 'WHEELS',
    location: 'NONE',
    brand: 'Project321',
    model: 'G3',
    isStock: true,
    notes: 'private note',
    installedAt: d('2025-09-15T16:00:00Z'),
    createdAt: d('2025-09-15T16:00:00Z'),
    retiredAt: null,
    hoursUsed: 40,
    priorHours: 0,
    lifetimeHours: 180.3,
    hoursSinceService: 40,
    countersComputedAt: d('2026-10-07T21:14:18Z'),
  };
  const logs = [
    // Newest first, as the builder asks for them.
    { performedAt: d('2026-09-01T12:00:00Z'), kind: 'INSPECTION', hoursAtService: 170, serviceExtensionHours: 30 },
    { performedAt: d('2026-08-01T12:00:00Z'), kind: 'SERVICE', hoursAtService: 140, serviceExtensionHours: null },
    { performedAt: d('2026-01-01T12:00:00Z'), kind: 'SERVICE', hoursAtService: 60, serviceExtensionHours: null },
  ];

  const makeDb = () => {
    const db = {
      componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      bikeComponentInstall: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'inst-1', bikeId: 'bike-1', slotKey: 'WHEEL_HUBS_NONE', installedAt: d('2025-09-15T16:00:00Z'), removedAt: null },
        ]),
      },
      serviceLog: { findMany: jest.fn().mockResolvedValue(logs) },
      ride: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r1', bikeId: 'bike-1', startTime: d('2026-08-10T10:00:00Z'),
            durationSeconds: 7200, distanceMeters: 20000, elevationGainMeters: 900,
          },
        ]),
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { AND: Array<Record<string, unknown>> } }) =>
          'garminActivityId' in where.AND[1] ? { id: 'r1' } : null
        ),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      bike: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'bike-1', manufacturer: 'Propain', model: 'TYEE 6 CF', year: 2025, thumbnailUrl: null },
        ]),
      },
    };
    return db;
  };
  const build = (db: ReturnType<typeof makeDb>, share: Record<string, unknown>) =>
    buildSharedComponentHistory(db as unknown as PrismaClient, {
      id: 'share-1', slug: 'abcdefghijkl', componentId: 'comp-1', userId: 'user-1',
      rangeStart: null, rangeEnd: null, createdAt: NOW,
      ...share,
      component: hubs,
    } as never);

  // The page is public, so what crosses it is an allowlist.
  it('never reads notes or bike nicknames, and names the part as GraphQL does', async () => {
    const db = makeDb();
    const result = await build(db, { scope: 'LIFETIME' });

    expect(db.serviceLog.findMany.mock.calls[0][0].select).not.toHaveProperty('notes');
    expect(db.bike.findMany.mock.calls[0][0].select).not.toHaveProperty('nickname');
    expect(result.component).toEqual({
      type: 'WHEEL_HUBS', location: 'NONE', brand: 'Project321', model: 'G3', isStock: true,
    });
    expect(JSON.stringify(result)).not.toContain('private note');
    expect(result.bikes[0].bike).toEqual({ manufacturer: 'Propain', model: 'TYEE 6 CF', year: 2025, thumbnailUrl: null });
    expect(result.contributingSources).toEqual(['garmin']);
  });

  it('shows the whole life for a lifetime link, with hours from the counter', async () => {
    const result = await build(makeDb(), { scope: 'LIFETIME' });

    expect(result.windowStart).toBeNull();
    expect(result.windowEnd).toBeNull();
    expect(result.totals.durationSeconds).toBe(Math.round(180.3 * 3600));
    expect(result.logbook).toHaveLength(3);
  });

  // An inspection that stood in for a service moves the due point, not the
  // date of the last service.
  it('starts a since-service link at the latest service, not a later inspection', async () => {
    const db = makeDb();
    const result = await build(db, { scope: 'SINCE_SERVICE' });

    expect(result.windowStart).toBe('2026-08-01T12:00:00.000Z');
    expect(db.ride.findMany.mock.calls[0][0].where).toMatchObject({
      startTime: { gte: d('2026-08-01T12:00:00Z') },
    });
    expect(result.totals.durationSeconds).toBe(40 * 3600);
    expect(result.logbook.map((l) => l.kind)).toEqual(['INSPECTION', 'SERVICE']);
  });

  it('limits a range link to its window, with hours summed from its rides', async () => {
    const db = makeDb();
    const result = await build(db, {
      scope: 'RANGE',
      rangeStart: d('2026-07-01T07:00:00Z'),
      rangeEnd: d('2026-08-15T07:00:00Z'),
    });

    expect(db.ride.findMany.mock.calls[0][0].where).toMatchObject({
      startTime: { gte: d('2026-07-01T07:00:00Z'), lt: d('2026-08-15T07:00:00Z') },
    });
    expect(result.totals.durationSeconds).toBe(7200);
    expect(result.logbook.map((l) => l.performedAt)).toEqual(['2026-08-01T12:00:00.000Z']);
    expect(result.windowEnd).toBe('2026-08-15T07:00:00.000Z');
  });

  // The allowlist holds for a fixed window too, including an inspection in it.
  it('keeps a range link to its allowlist, inspections included', async () => {
    const db = makeDb();
    const result = await build(db, {
      scope: 'RANGE',
      rangeStart: d('2026-08-15T07:00:00Z'),
      rangeEnd: d('2026-09-15T07:00:00Z'),
    });

    expect(result.logbook).toEqual([
      { performedAt: '2026-09-01T12:00:00.000Z', kind: 'INSPECTION', hoursAtService: 170, serviceExtensionHours: 30 },
    ]);
    expect(db.serviceLog.findMany.mock.calls[0][0].select).not.toHaveProperty('notes');
    expect(db.bike.findMany.mock.calls[0][0].select).not.toHaveProperty('nickname');
    expect(JSON.stringify(result)).not.toContain('private note');
  });

  it('counts declared pre-Loam hours only where the owner page does', async () => {
    const db = makeDb();
    const lifetime = await buildSharedComponentHistory(db as unknown as PrismaClient, {
      id: 's', slug: 'abcdefghijkl', componentId: 'comp-1', userId: 'user-1',
      scope: 'LIFETIME', rangeStart: null, rangeEnd: null, createdAt: NOW,
      component: { ...hubs, priorHours: 200 },
    } as never);
    const range = await buildSharedComponentHistory(makeDb() as unknown as PrismaClient, {
      id: 's', slug: 'abcdefghijkl', componentId: 'comp-1', userId: 'user-1',
      scope: 'RANGE', rangeStart: d('2026-07-01T07:00:00Z'), rangeEnd: d('2026-08-15T07:00:00Z'), createdAt: NOW,
      component: { ...hubs, priorHours: 200 },
    } as never);

    expect(lifetime.declaredPriorHours).toBe(200);
    expect(range.declaredPriorHours).toBe(0);
  });
});
