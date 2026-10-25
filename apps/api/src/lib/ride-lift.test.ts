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
  batchLiftFieldsByRideId,
  batchLiftSegmentsByRideId,
  buildRideLift,
  countedElevationGainMeters,
  countsLiftElevation,
  hasDetectedLift,
  liftKindFromAerialway,
} from './ride-lift';

const mockPrisma = prisma as unknown as {
  ride: { findMany: jest.Mock };
  rideSegment: { findMany: jest.Mock };
  liftGeometryLine: { findMany: jest.Mock };
};

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

  describe('countedElevationGainMeters', () => {
    const base = { elevationGainMeters: 2000, liftDurationSeconds: 1800, liftElevationGainMeters: 1500 };

    it('removes the lift climb by default', () => {
      expect(countedElevationGainMeters({ ...base, countLiftElevation: null })).toBe(500);
    });

    it('removes it when the rider chose not to count it', () => {
      expect(countedElevationGainMeters({ ...base, countLiftElevation: false })).toBe(500);
    });

    it('keeps the recorded climb when the rider counts the lift', () => {
      expect(countedElevationGainMeters({ ...base, countLiftElevation: true })).toBe(2000);
    });

    it('keeps the recorded climb on a ride with no lift or never analyzed', () => {
      expect(
        countedElevationGainMeters({ elevationGainMeters: 800, liftDurationSeconds: 0, liftElevationGainMeters: 0, countLiftElevation: null })
      ).toBe(800);
      expect(
        countedElevationGainMeters({ elevationGainMeters: 800, liftDurationSeconds: null, liftElevationGainMeters: null, countLiftElevation: null })
      ).toBe(800);
    });

    it('keeps the recorded climb for a lift that climbed nothing, whatever the choice', () => {
      expect(
        countedElevationGainMeters({ elevationGainMeters: 800, liftDurationSeconds: 600, liftElevationGainMeters: 0, countLiftElevation: false })
      ).toBe(800);
    });

    it('floors at zero when the recorded climb was edited below the lift share', () => {
      expect(
        countedElevationGainMeters({ elevationGainMeters: 300, liftDurationSeconds: 1800, liftElevationGainMeters: 1500, countLiftElevation: null })
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

    it('is null when no segment was detected', () => {
      expect(
        buildRideLift({ elevationGainMeters: 900, liftDurationSeconds: 0, liftElevationGainMeters: 0, countLiftElevation: null }, [])
      ).toBeNull();
    });

    it('reports the stored climb and the effective and saved choice', () => {
      expect(
        buildRideLift({ elevationGainMeters: 900, liftDurationSeconds: 960, liftElevationGainMeters: 800, countLiftElevation: null }, [
          segment,
          segment,
        ])
      ).toEqual({
        segments: [segment, segment],
        elevationGainMeters: 800,
        countElevation: false,
        countElevationChoice: null,
      });
    });

    it('sums the segments when the ride column is missing', () => {
      const lift = buildRideLift(
        { elevationGainMeters: 900, liftDurationSeconds: 960, liftElevationGainMeters: null, countLiftElevation: true },
        [segment, segment]
      );
      expect(lift?.elevationGainMeters).toBe(800);
      expect(lift?.countElevation).toBe(true);
      expect(lift?.countElevationChoice).toBe(true);
    });
  });

  describe('batchLiftFieldsByRideId', () => {
    it('returns rows in key order with null for missing rides', async () => {
      mockPrisma.ride.findMany.mockResolvedValue([
        { id: 'b', elevationGainMeters: 10, liftDurationSeconds: 600, liftElevationGainMeters: 5, countLiftElevation: true },
      ]);
      const rows = await batchLiftFieldsByRideId(['a', 'b']);
      expect(rows).toEqual([
        null,
        { id: 'b', elevationGainMeters: 10, liftDurationSeconds: 600, liftElevationGainMeters: 5, countLiftElevation: true },
      ]);
    });
  });

  describe('batchLiftSegmentsByRideId', () => {
    const seg = (rideId: string, liftOsmId: string | null, liftName: string | null) => ({
      rideId,
      startTime: new Date('2026-08-01T10:00:00Z'),
      endTime: new Date('2026-08-01T10:08:00Z'),
      durationSeconds: 480,
      elevationGainMeters: 400,
      distanceMeters: 1500,
      liftName,
      liftOsmId,
    });

    it('groups segments by ride and reads kinds from the active snapshot only', async () => {
      mockPrisma.rideSegment.findMany.mockResolvedValue([
        seg('r1', '111', 'Garbanzo Express'),
        seg('r1', null, null),
        seg('r2', '222', 'Village Gondola'),
        seg('r2', '333', null),
      ]);
      mockPrisma.liftGeometryLine.findMany.mockResolvedValue([
        { osmId: '111', kind: 'chair_lift' },
        { osmId: '222', kind: 'gondola' },
      ]);

      const [r1, r2, r3] = await batchLiftSegmentsByRideId(['r1', 'r2', 'r3']);

      expect(mockPrisma.rideSegment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { rideId: { in: ['r1', 'r2', 'r3'] }, kind: 'LIFT' } })
      );
      expect(mockPrisma.liftGeometryLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { osmId: { in: ['111', '222', '333'] }, import: { status: 'ACTIVE' } },
        })
      );
      expect(r1.map((s) => [s.liftName, s.kind])).toEqual([
        ['Garbanzo Express', 'CHAIRLIFT'],
        [null, null],
      ]);
      // 333 is not in the active snapshot: no kind, not a guess.
      expect(r2.map((s) => [s.liftName, s.kind])).toEqual([
        ['Village Gondola', 'GONDOLA'],
        [null, null],
      ]);
      expect(r3).toEqual([]);
      expect(r1[0]).not.toHaveProperty('liftOsmId');
    });

    it('skips the snapshot lookup when no segment was matched to a lift', async () => {
      mockPrisma.rideSegment.findMany.mockResolvedValue([seg('r1', null, null)]);
      const [r1] = await batchLiftSegmentsByRideId(['r1']);
      expect(mockPrisma.liftGeometryLine.findMany).not.toHaveBeenCalled();
      expect(r1).toHaveLength(1);
    });
  });
});
