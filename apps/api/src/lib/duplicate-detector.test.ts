import { isDuplicateActivity, type DuplicateCandidate } from './duplicate-detector';

describe('isDuplicateActivity', () => {
  const baseGarminRide: DuplicateCandidate = {
    id: 'garmin-1',
    startTime: new Date('2026-01-15T10:00:00Z'),
    durationSeconds: 3600,
    distanceMeters: 24140, // ~15 miles in meters
    elevationGainMeters: 457, // ~1500 feet in meters
    garminActivityId: 'garmin-123',
    stravaActivityId: null,
  };

  const baseStravaRide: DuplicateCandidate = {
    id: 'strava-1',
    startTime: new Date('2026-01-15T10:05:00Z'),
    durationSeconds: 3650, // Different duration (Strava/Garmin often differ)
    distanceMeters: 24300, // Within 5% threshold
    elevationGainMeters: 463, // Within 5% threshold
    garminActivityId: null,
    stravaActivityId: 'strava-456',
  };

  describe('same calendar day matching', () => {
    it('should detect duplicates on the same calendar day (UTC)', () => {
      expect(isDuplicateActivity(baseGarminRide, baseStravaRide)).toBe(true);
    });

    it('should NOT detect duplicates on different calendar days', () => {
      const differentDayRide: DuplicateCandidate = {
        ...baseStravaRide,
        startTime: new Date('2026-01-16T10:00:00Z'), // Next day
      };
      expect(isDuplicateActivity(baseGarminRide, differentDayRide)).toBe(false);
    });

    it('should handle rides at different times on the same day', () => {
      const eveningRide: DuplicateCandidate = {
        ...baseStravaRide,
        startTime: new Date('2026-01-15T22:00:00Z'), // Same day, 12 hours later
      };
      expect(isDuplicateActivity(baseGarminRide, eveningRide)).toBe(true);
    });

    it('should handle UTC date boundary correctly', () => {
      // A ride at 23:59 UTC on Jan 15
      const lateRide: DuplicateCandidate = {
        ...baseGarminRide,
        startTime: new Date('2026-01-15T23:59:00Z'),
      };
      // A ride at 00:01 UTC on Jan 16
      const earlyNextDayRide: DuplicateCandidate = {
        ...baseStravaRide,
        startTime: new Date('2026-01-16T00:01:00Z'),
      };
      // Should NOT be duplicates (different UTC days)
      expect(isDuplicateActivity(lateRide, earlyNextDayRide)).toBe(false);
    });
  });

  describe('different providers requirement', () => {
    it('should require rides from different providers', () => {
      const anotherGarminRide: DuplicateCandidate = {
        ...baseStravaRide,
        garminActivityId: 'garmin-789',
        stravaActivityId: null,
      };
      expect(isDuplicateActivity(baseGarminRide, anotherGarminRide)).toBe(false);
    });

    it('should NOT flag two Strava rides as duplicates', () => {
      const stravaRide1: DuplicateCandidate = {
        ...baseStravaRide,
        id: 'strava-1',
        stravaActivityId: 'strava-111',
      };
      const stravaRide2: DuplicateCandidate = {
        ...baseStravaRide,
        id: 'strava-2',
        stravaActivityId: 'strava-222',
      };
      expect(isDuplicateActivity(stravaRide1, stravaRide2)).toBe(false);
    });

    it('should detect Garmin vs Strava duplicates', () => {
      expect(isDuplicateActivity(baseGarminRide, baseStravaRide)).toBe(true);
    });

    it('should detect Strava vs Garmin duplicates (reverse order)', () => {
      expect(isDuplicateActivity(baseStravaRide, baseGarminRide)).toBe(true);
    });
  });

  describe('distance threshold', () => {
    it('should allow distance within 5% threshold', () => {
      const slightlyDifferentDistance: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMeters: 25270, // 4.7% difference from 24140
      };
      expect(isDuplicateActivity(baseGarminRide, slightlyDifferentDistance)).toBe(true);
    });

    it('should reject distance beyond 5% threshold', () => {
      const tooFarDistance: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMeters: 25760, // 6.7% difference from 24140
      };
      expect(isDuplicateActivity(baseGarminRide, tooFarDistance)).toBe(false);
    });

    it('should use 160m minimum threshold for short rides', () => {
      const shortRide1: DuplicateCandidate = {
        ...baseGarminRide,
        distanceMeters: 1000,
      };
      const shortRide2: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMeters: 1150, // Within 160m minimum threshold
      };
      expect(isDuplicateActivity(shortRide1, shortRide2)).toBe(true);

      const shortRide3: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMeters: 1200, // Beyond 160m minimum threshold
      };
      expect(isDuplicateActivity(shortRide1, shortRide3)).toBe(false);
    });
  });

  describe('elevation threshold', () => {
    it('should allow elevation within 5% threshold', () => {
      const slightlyDifferentElevation: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainMeters: 478, // 4.6% difference from 457
      };
      expect(isDuplicateActivity(baseGarminRide, slightlyDifferentElevation)).toBe(true);
    });

    it('should reject elevation beyond 5% threshold', () => {
      const tooMuchElevation: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainMeters: 520, // 13.8% difference from 457
      };
      expect(isDuplicateActivity(baseGarminRide, tooMuchElevation)).toBe(false);
    });

    it('should use 30m minimum threshold for flat rides', () => {
      const flatRide1: DuplicateCandidate = {
        ...baseGarminRide,
        elevationGainMeters: 15,
      };
      const flatRide2: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainMeters: 40, // Within 30m minimum threshold
      };
      expect(isDuplicateActivity(flatRide1, flatRide2)).toBe(true);

      const flatRide3: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainMeters: 50, // Beyond 30m minimum threshold
      };
      expect(isDuplicateActivity(flatRide1, flatRide3)).toBe(false);
    });
  });

  describe('duration is NOT checked', () => {
    it('should still detect duplicates with very different durations', () => {
      const differentDuration: DuplicateCandidate = {
        ...baseStravaRide,
        durationSeconds: 7200, // 2 hours vs 1 hour (100% difference)
      };
      // Duration check was removed because Strava/Garmin report different durations
      expect(isDuplicateActivity(baseGarminRide, differentDuration)).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    it('should detect typical Garmin/Strava duplicate from same ride', () => {
      const garminRide: DuplicateCandidate = {
        id: 'garmin-real',
        startTime: new Date('2026-01-03T15:30:00Z'),
        durationSeconds: 4320, // 1h 12m
        distanceMeters: 20117, // ~12.5 miles
        elevationGainMeters: 567, // ~1860 feet
        garminActivityId: 'garmin-real-123',
        stravaActivityId: null,
      };
      const stravaRide: DuplicateCandidate = {
        id: 'strava-real',
        startTime: new Date('2026-01-03T15:32:00Z'), // 2 min later start
        durationSeconds: 4280, // Slightly different duration
        distanceMeters: 19956, // GPS variance (~12.4 miles)
        elevationGainMeters: 567, // Same elevation
        garminActivityId: null,
        stravaActivityId: 'strava-real-456',
      };
      expect(isDuplicateActivity(garminRide, stravaRide)).toBe(true);
    });

    it('should NOT flag genuinely different rides on the same day', () => {
      const morningRide: DuplicateCandidate = {
        id: 'morning',
        startTime: new Date('2026-01-15T08:00:00Z'),
        durationSeconds: 3600,
        distanceMeters: 24140, // ~15 miles
        elevationGainMeters: 457, // ~1500 feet
        garminActivityId: 'garmin-morning',
        stravaActivityId: null,
      };
      const eveningRide: DuplicateCandidate = {
        id: 'evening',
        startTime: new Date('2026-01-15T18:00:00Z'),
        durationSeconds: 2400,
        distanceMeters: 12875, // Very different distance (~8 miles)
        elevationGainMeters: 152, // Very different elevation (~500 feet)
        garminActivityId: null,
        stravaActivityId: 'strava-evening',
      };
      expect(isDuplicateActivity(morningRide, eveningRide)).toBe(false);
    });
  });
});
