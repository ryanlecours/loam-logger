import { isDuplicateActivity, type DuplicateCandidate } from './duplicate-detector';

describe('isDuplicateActivity', () => {
  const baseGarminRide: DuplicateCandidate = {
    id: 'garmin-1',
    startTime: new Date('2026-01-15T10:00:00Z'),
    durationSeconds: 3600,
    distanceMiles: 15.0,
    elevationGainFeet: 1500,
    garminActivityId: 'garmin-123',
    stravaActivityId: null,
  };

  const baseStravaRide: DuplicateCandidate = {
    id: 'strava-1',
    startTime: new Date('2026-01-15T10:05:00Z'),
    durationSeconds: 3650, // Different duration (Strava/Garmin often differ)
    distanceMiles: 15.1, // Within 5% threshold
    elevationGainFeet: 1520, // Within 5% threshold
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
        distanceMiles: 15.7, // 4.7% difference from 15.0
      };
      expect(isDuplicateActivity(baseGarminRide, slightlyDifferentDistance)).toBe(true);
    });

    it('should reject distance beyond 5% threshold', () => {
      const tooFarDistance: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMiles: 16.0, // 6.7% difference from 15.0
      };
      expect(isDuplicateActivity(baseGarminRide, tooFarDistance)).toBe(false);
    });

    it('should use 0.1 mile minimum threshold for short rides', () => {
      const shortRide1: DuplicateCandidate = {
        ...baseGarminRide,
        distanceMiles: 1.0,
      };
      const shortRide2: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMiles: 1.08, // Within 0.1 mile minimum threshold
      };
      expect(isDuplicateActivity(shortRide1, shortRide2)).toBe(true);

      const shortRide3: DuplicateCandidate = {
        ...baseStravaRide,
        distanceMiles: 1.15, // Beyond 0.1 mile minimum threshold
      };
      expect(isDuplicateActivity(shortRide1, shortRide3)).toBe(false);
    });
  });

  describe('elevation threshold', () => {
    it('should allow elevation within 5% threshold', () => {
      const slightlyDifferentElevation: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainFeet: 1570, // 4.7% difference from 1500
      };
      expect(isDuplicateActivity(baseGarminRide, slightlyDifferentElevation)).toBe(true);
    });

    it('should reject elevation beyond 5% threshold', () => {
      const tooMuchElevation: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainFeet: 1700, // 13.3% difference from 1500
      };
      expect(isDuplicateActivity(baseGarminRide, tooMuchElevation)).toBe(false);
    });

    it('should use 100ft minimum threshold for flat rides', () => {
      const flatRide1: DuplicateCandidate = {
        ...baseGarminRide,
        elevationGainFeet: 50,
      };
      const flatRide2: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainFeet: 140, // Within 100ft minimum threshold
      };
      expect(isDuplicateActivity(flatRide1, flatRide2)).toBe(true);

      const flatRide3: DuplicateCandidate = {
        ...baseStravaRide,
        elevationGainFeet: 160, // Beyond 100ft minimum threshold
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
        distanceMiles: 12.5,
        elevationGainFeet: 1860,
        garminActivityId: 'garmin-real-123',
        stravaActivityId: null,
      };
      const stravaRide: DuplicateCandidate = {
        id: 'strava-real',
        startTime: new Date('2026-01-03T15:32:00Z'), // 2 min later start
        durationSeconds: 4280, // Slightly different duration
        distanceMiles: 12.4, // GPS variance
        elevationGainFeet: 1860, // Same elevation
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
        distanceMiles: 15.0,
        elevationGainFeet: 1500,
        garminActivityId: 'garmin-morning',
        stravaActivityId: null,
      };
      const eveningRide: DuplicateCandidate = {
        id: 'evening',
        startTime: new Date('2026-01-15T18:00:00Z'),
        durationSeconds: 2400,
        distanceMiles: 8.0, // Very different distance
        elevationGainFeet: 500, // Very different elevation
        garminActivityId: null,
        stravaActivityId: 'strava-evening',
      };
      expect(isDuplicateActivity(morningRide, eveningRide)).toBe(false);
    });
  });
});
