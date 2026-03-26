import {
  calculateRideWear,
  calculateWearDetailed,
  calculateTotalWear,
  calculateTotalHours,
  calculateWearPerHourRatio,
  generateWearDrivers,
  clamp,
} from '../wear';
import type { RideMetrics, ComponentWearWeights } from '../types';

describe('wear calculations', () => {
  // Standard test ride: 1 hour, ~10 miles, ~1500 ft elevation (in meters)
  const standardRide: RideMetrics = {
    durationSeconds: 3600, // 1 hour
    distanceMeters: 16093.44, // 10 miles in meters
    elevationGainMeters: 457.2, // 1500 feet in meters
    startTime: new Date('2024-01-15T10:00:00Z'),
  };

  // Standard weights for testing
  const standardWeights: ComponentWearWeights = {
    wH: 1.0,
    wD: 1.0,
    wC: 1.0,
    wV: 1.0,
  };

  describe('calculateRideWear', () => {
    it('should calculate wear using the spec formula', () => {
      // Formula: wearUnits = wH*H + wD*(D/10) + wC*(C/3000) + wV*(V/300)
      // Input is in meters, converted internally: D = 16093.44/1609.344 = 10 miles, C = 457.2*3.28084 = 1500 ft
      // H = 3600/3600 = 1
      // D = 10
      // C = 1500
      // V = 1500/10 = 150

      // Expected with standard weights (all 1.0):
      // 1.0*1 + 1.0*(10/10) + 1.0*(1500/3000) + 1.0*(150/300)
      // = 1 + 1 + 0.5 + 0.5 = 3.0

      const wear = calculateRideWear(standardRide, standardWeights);
      expect(wear).toBeCloseTo(3.0, 1);
    });

    it('should apply brake pad weights correctly', () => {
      // BRAKE_PAD weights: wH=0.8, wD=0.2, wC=1.2, wV=1.2
      const brakePadWeights: ComponentWearWeights = {
        wH: 0.8,
        wD: 0.2,
        wC: 1.2,
        wV: 1.2,
      };

      // 0.8*1 + 0.2*1 + 1.2*0.5 + 1.2*0.5
      // = 0.8 + 0.2 + 0.6 + 0.6 = 2.2
      const wear = calculateRideWear(standardRide, brakePadWeights);
      expect(wear).toBeCloseTo(2.2, 1);
    });

    it('should apply chain weights correctly', () => {
      // CHAIN weights: wH=1.0, wD=1.2, wC=0.5, wV=0.1
      const chainWeights: ComponentWearWeights = {
        wH: 1.0,
        wD: 1.2,
        wC: 0.5,
        wV: 0.1,
      };

      // 1.0*1 + 1.2*1 + 0.5*0.5 + 0.1*0.5
      // = 1.0 + 1.2 + 0.25 + 0.05 = 2.5
      const wear = calculateRideWear(standardRide, chainWeights);
      expect(wear).toBeCloseTo(2.5, 1);
    });

    it('should handle zero distance gracefully (V calculation)', () => {
      const zeroDistanceRide: RideMetrics = {
        durationSeconds: 3600,
        distanceMeters: 0,
        elevationGainMeters: 304.8, // 1000 feet in meters
        startTime: new Date(),
      };

      // D = 0/1609.344 = 0 miles, C = 304.8*3.28084 = ~1000 ft
      // V = 1000 / max(0, 1) = 1000
      // 1.0*1 + 1.0*0 + 1.0*(1000/3000) + 1.0*(1000/300)
      // = 1 + 0 + 0.333... + 3.333... = 4.666...
      const wear = calculateRideWear(zeroDistanceRide, standardWeights);
      expect(wear).toBeCloseTo(4.667, 1);
    });

    it('should return non-negative wear', () => {
      const emptyRide: RideMetrics = {
        durationSeconds: 0,
        distanceMeters: 0,
        elevationGainMeters: 0,
        startTime: new Date(),
      };

      const wear = calculateRideWear(emptyRide, standardWeights);
      expect(wear).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateWearDetailed', () => {
    it('should calculate total wear and breakdown', () => {
      const rides = [standardRide];
      const result = calculateWearDetailed(rides, standardWeights);

      expect(result.totalWearUnits).toBeCloseTo(3.0, 1);
      expect(result.totalHours).toBe(1.0);
      expect(result.breakdown.hours).toBeCloseTo(1.0, 1);
      expect(result.breakdown.distance).toBeCloseTo(1.0, 1);
      expect(result.breakdown.climbing).toBeCloseTo(0.5, 1);
      expect(result.breakdown.steepness).toBeCloseTo(0.5, 1);
    });

    it('should accumulate wear across multiple rides', () => {
      const rides = [standardRide, standardRide]; // 2 identical rides
      const result = calculateWearDetailed(rides, standardWeights);

      expect(result.totalWearUnits).toBeCloseTo(6.0, 1); // 3.0 * 2
      expect(result.totalHours).toBe(2.0);
    });

    it('should handle empty rides array', () => {
      const result = calculateWearDetailed([], standardWeights);

      expect(result.totalWearUnits).toBe(0);
      expect(result.totalHours).toBe(0);
    });
  });

  describe('calculateTotalWear', () => {
    it('should sum wear across rides', () => {
      const rides = [standardRide, standardRide];
      const wear = calculateTotalWear(rides, standardWeights);
      expect(wear).toBeCloseTo(6.0, 1);
    });
  });

  describe('calculateTotalHours', () => {
    it('should sum hours across rides', () => {
      const rides = [
        { ...standardRide, durationSeconds: 3600 }, // 1 hour
        { ...standardRide, durationSeconds: 7200 }, // 2 hours
      ];
      const hours = calculateTotalHours(rides);
      expect(hours).toBe(3.0);
    });
  });

  describe('calculateWearPerHourRatio', () => {
    it('should return 1.0 for empty rides', () => {
      const ratio = calculateWearPerHourRatio([], 'CHAIN');
      expect(ratio).toBe(1.0);
    });

    it('should calculate ratio based on component type', () => {
      const rides = [standardRide];
      const ratio = calculateWearPerHourRatio(rides, 'CHAIN');

      // Chain weights: wH=1.0, wD=1.2, wC=0.5, wV=0.1
      // Wear = 2.5 (calculated above)
      // Hours = 1.0
      // Ratio = 2.5 / 1.0 = 2.5
      expect(ratio).toBeCloseTo(2.5, 1);
    });
  });

  describe('generateWearDrivers', () => {
    it('should convert breakdown to sorted drivers', () => {
      const breakdown = {
        hours: 2.0,
        distance: 1.0,
        climbing: 0.5,
        steepness: 0.5,
      };

      const drivers = generateWearDrivers(breakdown);

      // Should be sorted by contribution descending
      expect(drivers[0].factor).toBe('hours');
      expect(drivers[0].contribution).toBe(50); // 2/4 = 50%
      expect(drivers[1].factor).toBe('distance');
      expect(drivers[1].contribution).toBe(25); // 1/4 = 25%
    });

    it('should handle zero total wear', () => {
      const breakdown = {
        hours: 0,
        distance: 0,
        climbing: 0,
        steepness: 0,
      };

      const drivers = generateWearDrivers(breakdown);

      // Should return equal distribution
      expect(drivers).toHaveLength(4);
      drivers.forEach((d) => expect(d.contribution).toBe(25));
    });

    it('should include human-readable labels', () => {
      const breakdown = {
        hours: 1,
        distance: 1,
        climbing: 1,
        steepness: 1,
      };

      const drivers = generateWearDrivers(breakdown);

      const labels = drivers.map((d) => d.label);
      expect(labels).toContain('Time in saddle');
      expect(labels).toContain('Distance ridden');
      expect(labels).toContain('Elevation gained');
      expect(labels).toContain('Ride intensity');
    });
  });

  describe('clamp', () => {
    it('should clamp value below minimum', () => {
      expect(clamp(0.5, 0.75, 1.5)).toBe(0.75);
    });

    it('should clamp value above maximum', () => {
      expect(clamp(2.0, 0.75, 1.5)).toBe(1.5);
    });

    it('should not modify value within range', () => {
      expect(clamp(1.0, 0.75, 1.5)).toBe(1.0);
    });
  });
});

describe('component-specific weight tests', () => {
  // Test ride for weight verification: 2 hours, ~15 miles, ~3000 ft elevation
  const testRide: RideMetrics = {
    durationSeconds: 7200, // 2 hours
    distanceMeters: 24140, // ~15 miles in meters
    elevationGainMeters: 914.4, // ~3000 feet in meters
    startTime: new Date(),
  };

  // After conversion: D = 15 miles, C = 3000 ft, V = 3000 / 15 = 200 ft/mile

  it('BRAKE_PAD should have high climb/steepness sensitivity', () => {
    const brakePadWeights: ComponentWearWeights = {
      wH: 0.8,
      wD: 0.2,
      wC: 1.2,
      wV: 1.2,
    };

    const result = calculateWearDetailed([testRide], brakePadWeights);

    // Climbing and steepness should contribute significantly
    const climbContrib = result.breakdown.climbing / result.totalWearUnits;
    const steepContrib = result.breakdown.steepness / result.totalWearUnits;

    expect(climbContrib + steepContrib).toBeGreaterThan(0.5); // > 50% from descent factors
  });

  it('CHAIN should have high distance sensitivity', () => {
    const chainWeights: ComponentWearWeights = {
      wH: 1.0,
      wD: 1.2,
      wC: 0.5,
      wV: 0.1,
    };

    const result = calculateWearDetailed([testRide], chainWeights);

    // Distance should be a major contributor
    const distanceContrib = result.breakdown.distance / result.totalWearUnits;
    expect(distanceContrib).toBeGreaterThan(0.25);
  });

  it('FORK should have high hours sensitivity', () => {
    const forkWeights: ComponentWearWeights = {
      wH: 1.3,
      wD: 0.3,
      wC: 0.2,
      wV: 0.1,
    };

    const result = calculateWearDetailed([testRide], forkWeights);

    // Hours should be the dominant factor
    const hoursContrib = result.breakdown.hours / result.totalWearUnits;
    expect(hoursContrib).toBeGreaterThan(0.5);
  });
});
