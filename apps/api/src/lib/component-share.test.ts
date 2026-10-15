import type { PrismaClient } from '@prisma/client';
import {
  buildSharedComponentHistory,
  rideLocalDate,
  sharedComponentRidesPage,
  componentStartDate,
  rangeError,
  shareWindow,
} from './component-share';
import { buildCountedRideWhere, RIDE_OFFSET_MAX } from './component-history';

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

describe('rideLocalDate', () => {
  // 01:30 UTC on Aug 11 is the evening of Aug 10 anywhere in the Americas.
  const lateEvening = d('2026-08-11T01:30:00Z');

  it('dates a ride by where it was ridden, from its start longitude', () => {
    expect(rideLocalDate(lateEvening, -122.3, null)).toBe('2026-08-10');
    // The owner's zone is ignored when the ride itself says where it was.
    expect(rideLocalDate(lateEvening, 8.5, 'America/Los_Angeles')).toBe('2026-08-11');
  });

  it("falls back to the owner's timezone for a ride with no GPS start", () => {
    expect(rideLocalDate(lateEvening, null, 'America/Denver')).toBe('2026-08-10');
  });

  it('falls back to UTC with no position and no zone, or an unknown zone', () => {
    expect(rideLocalDate(lateEvening, null, null)).toBe('2026-08-11');
    expect(rideLocalDate(lateEvening, null, 'Not/AZone')).toBe('2026-08-11');
  });
});

describe('sharedComponentRidesPage', () => {
  const hubs = {
    id: 'comp-1',
    userId: 'user-1',
    bikeId: 'bike-1',
    installedAt: d('2025-09-15T16:00:00Z'),
    createdAt: d('2025-09-15T16:00:00Z'),
    retiredAt: null,
    hoursUsed: 40,
  };
  const rows = [
    {
      // The evening of Aug 10 near Seattle, though already Aug 11 in UTC.
      startTime: d('2026-08-11T01:30:00Z'), startLng: -122.0,
      durationSeconds: 7200, distanceMeters: 20000, elevationGainMeters: 900,
      trailSystem: 'Duthie Hill', location: 'Issaquah, WA',
      stravaActivityId: 's-1', stravaDeviceName: 'Garmin Edge 840', garminActivityId: null, garminDeviceName: null,
      whoopWorkoutId: null, suuntoWorkoutId: null,
    },
    {
      // No GPS start: dated in the owner's timezone.
      startTime: d('2026-08-09T10:00:00Z'), startLng: null,
      durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 400,
      trailSystem: null, location: null,
      stravaActivityId: null, stravaDeviceName: null, garminActivityId: null, garminDeviceName: null,
      whoopWorkoutId: null, suuntoWorkoutId: null,
    },
  ];

  const makeDb = (found = rows) => ({
    componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([{ rideId: 'r-out', kind: 'EXCLUDE' }]) },
    bikeComponentInstall: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'inst-1', bikeId: 'bike-1', slotKey: 'WHEEL_HUBS_NONE', installedAt: d('2025-09-15T16:00:00Z'), removedAt: null },
      ]),
    },
    serviceLog: { findFirst: jest.fn().mockResolvedValue({ performedAt: d('2026-08-01T12:00:00Z') }) },
    ride: { findMany: jest.fn().mockResolvedValue(found) },
    user: { findUnique: jest.fn().mockResolvedValue({ timezone: 'America/Los_Angeles' }) },
  });
  const page = (db: ReturnType<typeof makeDb>, share: Record<string, unknown>, take = 25, offset = 0) =>
    sharedComponentRidesPage(
      db as unknown as PrismaClient,
      {
        id: 'share-1', slug: 'abcdefghijkl', componentId: 'comp-1', userId: 'user-1',
        scope: 'LIFETIME', rangeStart: null, rangeEnd: null, createdAt: NOW,
        ...share,
        component: hubs,
      } as never,
      { take, offset }
    );

  // Covers a link toggled off after it was sent too: the flag is all it reads.
  it('is null for a link without the opt-in, without reading any rides', async () => {
    const db = makeDb();
    expect(await page(db, { includeRides: false })).toBeNull();
    expect(db.ride.findMany).not.toHaveBeenCalled();
  });

  // The page is public, so each row is an allowlist: no ids, notes, heart rate,
  // weather or time of day. Provider ids are read only to attribute the row.
  it('lists only allowlisted fields, dated by day, with each ride attributed', async () => {
    const db = makeDb();
    const result = await page(db, { includeRides: true });

    expect(result?.rides).toEqual([
      {
        date: '2026-08-10', durationSeconds: 7200, distanceMeters: 20000, elevationGainMeters: 900,
        trailSystem: 'Duthie Hill', location: 'Issaquah, WA',
        // Recorded on a Garmin and imported via Strava: both are attributed.
        sources: ['strava', 'garmin'], garminAttribution: 'Garmin Edge 840',
      },
      {
        date: '2026-08-09', durationSeconds: 3600, distanceMeters: 10000, elevationGainMeters: 400,
        trailSystem: null, location: null, sources: [], garminAttribution: null,
      },
    ]);
    const select = db.ride.findMany.mock.calls[0][0].select;
    for (const field of ['id', 'notes', 'averageHr', 'weather', 'bikeId', 'userId', 'startLat']) {
      expect(select).not.toHaveProperty(field);
    }
    const json = JSON.stringify(result);
    expect(json).not.toContain('s-1');
    expect(json).not.toContain('T01:30');
    expect(json).not.toContain('-122');
  });

  it("reads the owner's timezone only when a ride has no GPS start", async () => {
    const db = makeDb([rows[0]]);
    await page(db, { includeRides: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();

    const fallback = makeDb([rows[1]]);
    await page(fallback, { includeRides: true });
    expect(fallback.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { timezone: true } });
  });

  it('keeps a range link to its fixed window', async () => {
    const db = makeDb();
    await page(db, {
      includeRides: true,
      scope: 'RANGE',
      rangeStart: d('2026-07-01T07:00:00Z'),
      rangeEnd: d('2026-08-15T07:00:00Z'),
    });
    expect(db.ride.findMany.mock.calls[0][0].where).toMatchObject({
      startTime: { gte: d('2026-07-01T07:00:00Z'), lt: d('2026-08-15T07:00:00Z') },
    });
  });

  it('follows the counted-ride rule and the link window, newest first', async () => {
    const db = makeDb();
    await page(db, { includeRides: true, scope: 'SINCE_SERVICE' });

    const args = db.ride.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      userId: 'user-1',
      isDuplicate: false,
      id: { notIn: ['r-out'] },
      startTime: { gte: d('2026-08-01T12:00:00Z') },
    });
    expect(args.orderBy).toEqual([{ startTime: 'desc' }, { id: 'desc' }]);
  });

  it('pages by offset, reading one extra row to answer hasMore', async () => {
    const db = makeDb();
    const result = await page(db, { includeRides: true }, 1, 5);

    expect(db.ride.findMany.mock.calls[0][0]).toMatchObject({ skip: 5, take: 2 });
    expect(result?.rides).toHaveLength(1);
    expect(result?.hasMore).toBe(true);
  });

  it('clamps take and offset to sane bounds', async () => {
    const db = makeDb();
    await page(db, { includeRides: true }, 5000, -3);
    await page(db, { includeRides: true }, 0, 0);
    await page(db, { includeRides: true }, -10, 0);

    expect(db.ride.findMany.mock.calls.map(([args]) => [args.skip, args.take])).toEqual([
      [0, 101],
      [0, 2],
      [0, 2],
    ]);
  });

  // Postgres reads every skipped row, and this endpoint is public.
  it('stops paging at the depth cap rather than scanning further', async () => {
    const db = makeDb();
    expect(await page(db, { includeRides: true }, 25, RIDE_OFFSET_MAX)).toEqual({ rides: [], hasMore: false });
    expect(db.ride.findMany).not.toHaveBeenCalled();

    // The last page before the cap is trimmed to it, and says there is no more.
    const last = await page(db, { includeRides: true }, 25, RIDE_OFFSET_MAX - 1);
    expect(db.ride.findMany.mock.calls[0][0]).toMatchObject({ skip: RIDE_OFFSET_MAX - 1, take: 2 });
    expect(last?.rides).toHaveLength(1);
    expect(last?.hasMore).toBe(false);
  });
});
