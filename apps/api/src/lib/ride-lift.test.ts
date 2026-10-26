jest.mock('./prisma', () => ({
  prisma: {
    ride: { findMany: jest.fn() },
    rideSegment: { findMany: jest.fn() },
    liftGeometryLine: { findMany: jest.fn() },
  },
}));

import { prisma } from './prisma';
import {
  LIFT_ELEVATION_COUNTED_BY_DEFAULT,
  MAPPED_LIFT_SEGMENT_WHERE,
  RIDEABLE_LIFT_KINDS,
  batchLiftFieldsByRideId,
  batchLiftSegmentsByRideId,
  buildRideLift,
  countedElevationGainMeters,
  countsLiftElevation,
  hasDetectedLift,
  hysteresisClimbMeters,
  TRACK_CLIMB_HYSTERESIS_METERS,
  liftKindFromAerialway,
  liftRiseMeters,
  trackClimbMeters,
  type LiftElevationFields,
} from './ride-lift';

const mockPrisma = prisma as unknown as {
  ride: { findMany: jest.Mock };
  rideSegment: { findMany: jest.Mock };
  liftGeometryLine: { findMany: jest.Mock };
};

const FT = 0.3048;

const fields = (overrides: Partial<LiftElevationFields> = {}): LiftElevationFields => ({
  elevationGainMeters: 2000,
  liftDurationSeconds: 1800,
  liftElevationGainMeters: 1500,
  trackElevationGainMeters: 2500,
  countLiftElevation: null,
  ...overrides,
});

describe('ride-lift', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('countsLiftElevation', () => {
    it('does not count an unanswered choice', () => {
      expect(LIFT_ELEVATION_COUNTED_BY_DEFAULT).toBe(false);
      expect(countsLiftElevation(null)).toBe(false);
      expect(countsLiftElevation(undefined)).toBe(false);
    });

    it('follows an explicit answer either way', () => {
      expect(countsLiftElevation(true)).toBe(true);
      expect(countsLiftElevation(false)).toBe(false);
    });
  });

  describe('hasDetectedLift', () => {
    it('is true when the detector stored lift time', () => {
      expect(hasDetectedLift({ liftDurationSeconds: 1800 })).toBe(true);
    });

    it('is false for an analyzed ride with no lift and for a ride never analyzed', () => {
      expect(hasDetectedLift({ liftDurationSeconds: 0 })).toBe(false);
      expect(hasDetectedLift({ liftDurationSeconds: null })).toBe(false);
    });
  });

  describe('liftRiseMeters', () => {
    it('sums the segments, ignoring a segment that lost height', () => {
      expect(liftRiseMeters([{ elevationGainMeters: 400 }, { elevationGainMeters: 300 }])).toBe(700);
      expect(liftRiseMeters([{ elevationGainMeters: 400 }, { elevationGainMeters: -20 }])).toBe(400);
      expect(liftRiseMeters([])).toBe(0);
    });
  });

  describe('hysteresisClimbMeters', () => {
    it('counts a steady climb and ignores jitter smaller than the threshold', () => {
      // Real climbs of 50 and 80 m, with +-2 m noise riding on top.
      const noisy = [100, 102, 100, 102, 150, 148, 150, 120, 122, 120, 200, 198, 200];
      expect(hysteresisClimbMeters(noisy, 5)).toBe(130);
      // Summing every up-step counts each wiggle as climb.
      expect(hysteresisClimbMeters(noisy, 0)).toBe(138);
    });

    it('turns pure noise into no climb at all', () => {
      expect(hysteresisClimbMeters([500, 503, 499, 502, 500, 504, 501], 5)).toBe(0);
    });

    it('counts a rise made of small steps once it passes the threshold', () => {
      expect(hysteresisClimbMeters([0, 1, 2, 3, 4, 5, 6, 7], 5)).toBe(5);
    });

    it('skips non-finite altitudes', () => {
      expect(hysteresisClimbMeters([100, Number.NaN, Number.POSITIVE_INFINITY, 140], 5)).toBe(40);
    });

    it('defaults to the calibrated threshold', () => {
      expect(TRACK_CLIMB_HYSTERESIS_METERS).toBeGreaterThan(0);
      const steps = [0, TRACK_CLIMB_HYSTERESIS_METERS - 1, 0];
      expect(hysteresisClimbMeters(steps)).toBe(0);
    });
  });

  describe('trackClimbMeters', () => {
    const pt = (t: number, ele: number) => ({ t, ele, lat: 50.1, lng: -122.9 });

    it('sums the smoothed climb over the whole track', () => {
      expect(trackClimbMeters([pt(0, 100), pt(10, 150), pt(20, 120), pt(30, 200)])).toBe(130);
      expect(trackClimbMeters([pt(0, 100), pt(10, 103), pt(20, 100)])).toBe(0);
    });

    it('takes a threshold for calibration', () => {
      expect(trackClimbMeters([pt(0, 100), pt(10, 103), pt(20, 100)], [], 0)).toBe(3);
    });

    it("counts a lift span as its net rise, so altitude noise on the lift adds nothing", () => {
      // Riding 100 -> 150 (50), lift 150 -> 400 with 60 m swings, riding 400 -> 420 (20).
      const points = [100, 150, 210, 170, 260, 200, 330, 290, 400, 420].map((e, i) => pt(i * 10, e));
      const lift = [{ startIndex: 1, endIndex: 8 }];
      expect(trackClimbMeters(points, lift)).toBe(50 + 250 + 20);
      // Unsplit, the swings on the lift count as climb.
      expect(trackClimbMeters(points)).toBeGreaterThan(400);
    });

    it('adds nothing for a span that ends lower than it starts', () => {
      const points = [100, 150, 140, 120, 160].map((e, i) => pt(i * 10, e));
      expect(trackClimbMeters(points, [{ startIndex: 1, endIndex: 3 }])).toBe(50 + 40);
    });

    it('handles unsorted, out-of-range and overlapping spans', () => {
      const points = [0, 100, 200, 300, 400, 500].map((e, i) => pt(i * 10, e));
      const spans = [
        { startIndex: 3, endIndex: 5 },
        { startIndex: 0, endIndex: 3 },
        { startIndex: 2, endIndex: 4 },
        { startIndex: 4, endIndex: 99 },
      ];
      expect(trackClimbMeters(points, spans)).toBe(500);
    });

    it('is null for a track too short to climb', () => {
      expect(trackClimbMeters(null)).toBeNull();
      expect(trackClimbMeters([pt(0, 100)])).toBeNull();
    });
  });

  describe('countedElevationGainMeters', () => {
    it('takes the lift share of the track climb out of the recorded climb', () => {
      // Lift did 1,500 of the track's 2,500 m, so 40% of the recorded 2,000 m counts.
      expect(countedElevationGainMeters(fields(), 1500)).toBeCloseTo(800);
      expect(countedElevationGainMeters(fields({ countLiftElevation: false }), 1500)).toBeCloseTo(800);
    });

    it('does not wipe out a ride whose lift rose more than the recorded total', () => {
      // The Whistler case: 7,468 ft of lift rise against 6,711 ft recorded used
      // to count 0. With a track climb of 8,600 ft, 1,132 ft of it was ridden.
      const counted = countedElevationGainMeters(
        fields({ elevationGainMeters: 6711 * FT, trackElevationGainMeters: 8600 * FT }),
        7468 * FT
      );
      expect(counted / FT).toBeCloseTo(6711 * (1132 / 8600));
      expect(counted).toBeGreaterThan(0);
    });

    it('reaches zero only when every foot of the track was on a lift', () => {
      expect(countedElevationGainMeters(fields({ trackElevationGainMeters: 1500 }), 1500)).toBe(0);
      expect(countedElevationGainMeters(fields({ trackElevationGainMeters: 1400 }), 1500)).toBe(0);
    });

    it('keeps the recorded climb when the rider counts the lift', () => {
      expect(countedElevationGainMeters(fields({ countLiftElevation: true }), 1500)).toBe(2000);
    });

    it('keeps the recorded climb with no mapped lift rise', () => {
      expect(countedElevationGainMeters(fields(), 0)).toBe(2000);
      expect(countedElevationGainMeters(fields({ liftDurationSeconds: null, trackElevationGainMeters: null }), 0)).toBe(2000);
    });

    it('falls back to the subtraction, floored at zero, before the track climb is known', () => {
      expect(countedElevationGainMeters(fields({ trackElevationGainMeters: null }), 1500)).toBe(500);
      expect(countedElevationGainMeters(fields({ trackElevationGainMeters: 0 }), 1500)).toBe(500);
      expect(
        countedElevationGainMeters(fields({ elevationGainMeters: 300, trackElevationGainMeters: null }), 1500)
      ).toBe(0);
    });
  });

  describe('liftKindFromAerialway', () => {
    it.each([
      ['chair_lift', 'CHAIRLIFT'],
      ['mixed_lift', 'CHAIRLIFT'],
      ['gondola', 'GONDOLA'],
      ['cable_car', 'GONDOLA'],
      ['t-bar', 'OTHER'],
      ['magic_carpet', 'OTHER'],
    ])('maps %s to %s', (tag, kind) => {
      expect(liftKindFromAerialway(tag)).toBe(kind);
    });

    it('has no kind without a tag', () => {
      expect(liftKindFromAerialway(null)).toBeNull();
      expect(liftKindFromAerialway(undefined)).toBeNull();
    });
  });

  describe('buildRideLift', () => {
    const segment = {
      startTime: new Date('2026-08-01T10:00:00Z'),
      endTime: new Date('2026-08-01T10:08:00Z'),
      durationSeconds: 480,
      elevationGainMeters: 400,
      distanceMeters: 1500,
      liftName: 'Fitzsimmons Express',
      kind: 'CHAIRLIFT' as const,
    };

    it('is null when no mapped lift was found', () => {
      expect(buildRideLift(fields(), [])).toBeNull();
    });

    it('sums the mapped segments, not the Ride column that also holds motion-only ones', () => {
      expect(buildRideLift(fields({ liftElevationGainMeters: 1500 }), [segment, segment])).toEqual({
        segments: [segment, segment],
        elevationGainMeters: 800,
        countElevation: false,
        countElevationChoice: null,
      });
    });

    it('reports a saved answer', () => {
      const lift = buildRideLift(fields({ countLiftElevation: true }), [segment]);
      expect(lift?.countElevation).toBe(true);
      expect(lift?.countElevationChoice).toBe(true);
    });
  });

  describe('batchLiftFieldsByRideId', () => {
    it('returns rows in key order with null for missing rides', async () => {
      const row = { id: 'b', ...fields() };
      mockPrisma.ride.findMany.mockResolvedValue([row]);
      const rows = await batchLiftFieldsByRideId(['a', 'b']);
      expect(rows).toEqual([null, row]);
      expect(mockPrisma.ride.findMany.mock.calls[0][0].select).toMatchObject({
        trackElevationGainMeters: true,
        liftDurationSeconds: true,
      });
    });
  });

  describe('batchLiftSegmentsByRideId', () => {
    const seg = (rideId: string, liftOsmId: string, liftName: string | null) => ({
      rideId,
      startTime: new Date('2026-08-01T10:00:00Z'),
      endTime: new Date('2026-08-01T10:08:00Z'),
      durationSeconds: 480,
      elevationGainMeters: 400,
      distanceMeters: 1500,
      liftName,
      liftOsmId,
    });

    it('asks only for segments matched to a mapped lift', async () => {
      mockPrisma.rideSegment.findMany.mockResolvedValue([]);
      await batchLiftSegmentsByRideId(['r1']);
      expect(mockPrisma.rideSegment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { rideId: { in: ['r1'] }, kind: 'LIFT', liftOsmId: { not: null } },
        })
      );
      expect(MAPPED_LIFT_SEGMENT_WHERE).toEqual({ kind: 'LIFT', liftOsmId: { not: null } });
      expect(mockPrisma.liftGeometryLine.findMany).not.toHaveBeenCalled();
    });

    it('groups segments by ride and reads kinds from the active snapshot', async () => {
      mockPrisma.rideSegment.findMany.mockResolvedValue([
        seg('r1', '111', 'Garbanzo Express'),
        seg('r2', '222', 'Village Gondola'),
        seg('r2', '444', 'Peak Chair'),
      ]);
      mockPrisma.liftGeometryLine.findMany.mockResolvedValue([
        { osmId: '111', kind: 'chair_lift' },
        { osmId: '222', kind: 'cable_car' },
        { osmId: '444', kind: 'mixed_lift' },
      ]);

      const [r1, r2, r3] = await batchLiftSegmentsByRideId(['r1', 'r2', 'r3']);

      expect(mockPrisma.liftGeometryLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { osmId: { in: ['111', '222', '444'] }, import: { status: 'ACTIVE' } },
        })
      );
      expect(r1.map((s) => [s.liftName, s.kind])).toEqual([['Garbanzo Express', 'CHAIRLIFT']]);
      expect(r2.map((s) => [s.liftName, s.kind])).toEqual([
        ['Village Gondola', 'GONDOLA'],
        ['Peak Chair', 'CHAIRLIFT'],
      ]);
      expect(r3).toEqual([]);
      expect(r1[0]).not.toHaveProperty('liftOsmId');
    });

    it('drops surface lifts: a T-Bar does not carry a bike', async () => {
      // The Franklin, NH case: the one mapped "lift" left was a ski area T-Bar.
      mockPrisma.rideSegment.findMany.mockResolvedValue([
        seg('r1', '501', 'T-Bar'),
        seg('r1', '502', 'Bunny Tow'),
        seg('r1', '503', 'Carpet'),
      ]);
      mockPrisma.liftGeometryLine.findMany.mockResolvedValue([
        { osmId: '501', kind: 't-bar' },
        { osmId: '502', kind: 'rope_tow' },
        { osmId: '503', kind: 'magic_carpet' },
      ]);

      const [r1] = await batchLiftSegmentsByRideId(['r1']);
      expect(r1).toEqual([]);
      expect([...RIDEABLE_LIFT_KINDS].sort()).toEqual(['CHAIRLIFT', 'GONDOLA']);
    });

    it('drops a lift missing from the active snapshot, whose kind cannot be confirmed', async () => {
      mockPrisma.rideSegment.findMany.mockResolvedValue([
        seg('r1', '111', 'Garbanzo Express'),
        seg('r1', '333', 'Old Chair'),
      ]);
      mockPrisma.liftGeometryLine.findMany.mockResolvedValue([{ osmId: '111', kind: 'chair_lift' }]);

      const [r1] = await batchLiftSegmentsByRideId(['r1']);
      expect(r1.map((s) => s.liftName)).toEqual(['Garbanzo Express']);
    });
  });
});
