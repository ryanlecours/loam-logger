import {
  BASE_INTERVALS_HOURS,
  COMPONENT_WEIGHTS,
  getBaseInterval,
  getComponentWeights,
  isTrackableComponent,
  DEFAULT_INTERVAL_HOURS,
  type LocationBasedInterval,
} from '../config';
import type { ComponentType, ComponentLocation } from '@prisma/client';

describe('prediction config', () => {
  describe('BASE_INTERVALS_HOURS', () => {
    it('should have location-based intervals for BRAKE_PAD', () => {
      const interval = BASE_INTERVALS_HOURS.BRAKE_PAD as LocationBasedInterval;

      expect(interval).toBeDefined();
      expect(interval.front).toBe(40);
      expect(interval.rear).toBe(35);
    });

    it('should have location-based intervals for BRAKE_ROTOR', () => {
      const interval = BASE_INTERVALS_HOURS.BRAKE_ROTOR as LocationBasedInterval;

      expect(interval).toBeDefined();
      expect(interval.front).toBe(200);
      expect(interval.rear).toBe(200);
    });

    it('should have location-based intervals for BRAKES', () => {
      const interval = BASE_INTERVALS_HOURS.BRAKES as LocationBasedInterval;

      expect(interval).toBeDefined();
      expect(interval.front).toBe(100);
      expect(interval.rear).toBe(100);
    });

    it('should have location-based intervals for TIRES', () => {
      const interval = BASE_INTERVALS_HOURS.TIRES as LocationBasedInterval;

      expect(interval).toBeDefined();
      expect(interval.front).toBe(120);
      expect(interval.rear).toBe(100);
    });

    it('should have simple number intervals for non-paired components', () => {
      expect(BASE_INTERVALS_HOURS.FORK).toBe(50);
      expect(BASE_INTERVALS_HOURS.SHOCK).toBe(50);
      expect(BASE_INTERVALS_HOURS.CHAIN).toBe(70);
      expect(BASE_INTERVALS_HOURS.CASSETTE).toBe(200);
      expect(BASE_INTERVALS_HOURS.DROPPER).toBe(150);
    });

    it('should have interval for WHEEL_HUBS (hub bearing service)', () => {
      expect(BASE_INTERVALS_HOURS.WHEEL_HUBS).toBe(250);
    });

    it('should have interval for REAR_DERAILLEUR (cable/housing replacement)', () => {
      expect(BASE_INTERVALS_HOURS.REAR_DERAILLEUR).toBe(200);
    });
  });

  describe('getBaseInterval', () => {
    describe('for location-based components', () => {
      it('should return front interval for BRAKE_PAD FRONT', () => {
        const result = getBaseInterval('BRAKE_PAD' as ComponentType, 'FRONT' as ComponentLocation);
        expect(result).toBe(40);
      });

      it('should return rear interval for BRAKE_PAD REAR', () => {
        const result = getBaseInterval('BRAKE_PAD' as ComponentType, 'REAR' as ComponentLocation);
        expect(result).toBe(35);
      });

      it('should return front interval for BRAKE_PAD NONE (fallback)', () => {
        const result = getBaseInterval('BRAKE_PAD' as ComponentType, 'NONE' as ComponentLocation);
        expect(result).toBe(40);
      });

      it('should return front interval for TIRES FRONT', () => {
        const result = getBaseInterval('TIRES' as ComponentType, 'FRONT' as ComponentLocation);
        expect(result).toBe(120);
      });

      it('should return rear interval for TIRES REAR', () => {
        const result = getBaseInterval('TIRES' as ComponentType, 'REAR' as ComponentLocation);
        expect(result).toBe(100);
      });

      it('should return front interval for BRAKE_ROTOR FRONT', () => {
        const result = getBaseInterval('BRAKE_ROTOR' as ComponentType, 'FRONT' as ComponentLocation);
        expect(result).toBe(200);
      });

      it('should return rear interval for BRAKE_ROTOR REAR', () => {
        const result = getBaseInterval('BRAKE_ROTOR' as ComponentType, 'REAR' as ComponentLocation);
        expect(result).toBe(200);
      });

      it('should return front interval for BRAKES FRONT', () => {
        const result = getBaseInterval('BRAKES' as ComponentType, 'FRONT' as ComponentLocation);
        expect(result).toBe(100);
      });

      it('should return rear interval for BRAKES REAR', () => {
        const result = getBaseInterval('BRAKES' as ComponentType, 'REAR' as ComponentLocation);
        expect(result).toBe(100);
      });
    });

    describe('for non-location-based components', () => {
      it('should return same interval regardless of location for FORK', () => {
        expect(getBaseInterval('FORK' as ComponentType, 'FRONT' as ComponentLocation)).toBe(50);
        expect(getBaseInterval('FORK' as ComponentType, 'REAR' as ComponentLocation)).toBe(50);
        expect(getBaseInterval('FORK' as ComponentType, 'NONE' as ComponentLocation)).toBe(50);
      });

      it('should return same interval regardless of location for SHOCK', () => {
        expect(getBaseInterval('SHOCK' as ComponentType, 'FRONT' as ComponentLocation)).toBe(50);
        expect(getBaseInterval('SHOCK' as ComponentType, 'REAR' as ComponentLocation)).toBe(50);
        expect(getBaseInterval('SHOCK' as ComponentType, 'NONE' as ComponentLocation)).toBe(50);
      });

      it('should return same interval regardless of location for CHAIN', () => {
        expect(getBaseInterval('CHAIN' as ComponentType, 'NONE' as ComponentLocation)).toBe(70);
      });

      it('should return same interval regardless of location for WHEEL_HUBS', () => {
        expect(getBaseInterval('WHEEL_HUBS' as ComponentType, 'FRONT' as ComponentLocation)).toBe(250);
        expect(getBaseInterval('WHEEL_HUBS' as ComponentType, 'REAR' as ComponentLocation)).toBe(250);
        expect(getBaseInterval('WHEEL_HUBS' as ComponentType, 'NONE' as ComponentLocation)).toBe(250);
      });

      it('should return same interval regardless of location for REAR_DERAILLEUR', () => {
        expect(getBaseInterval('REAR_DERAILLEUR' as ComponentType, 'NONE' as ComponentLocation)).toBe(200);
      });
    });

    describe('for unknown component types', () => {
      it('should return DEFAULT_INTERVAL_HOURS', () => {
        const result = getBaseInterval('UNKNOWN' as ComponentType, 'NONE' as ComponentLocation);
        expect(result).toBe(DEFAULT_INTERVAL_HOURS);
      });
    });
  });

  describe('rear brake pad wears faster than front', () => {
    it('should have shorter interval for rear brake pads', () => {
      const frontInterval = getBaseInterval('BRAKE_PAD' as ComponentType, 'FRONT' as ComponentLocation);
      const rearInterval = getBaseInterval('BRAKE_PAD' as ComponentType, 'REAR' as ComponentLocation);

      expect(rearInterval).toBeLessThan(frontInterval);
    });
  });

  describe('rear tire wears faster than front', () => {
    it('should have shorter interval for rear tires', () => {
      const frontInterval = getBaseInterval('TIRES' as ComponentType, 'FRONT' as ComponentLocation);
      const rearInterval = getBaseInterval('TIRES' as ComponentType, 'REAR' as ComponentLocation);

      expect(rearInterval).toBeLessThan(frontInterval);
    });
  });

  describe('COMPONENT_WEIGHTS', () => {
    it('should have weights for WHEEL_HUBS (primarily hours-based)', () => {
      const weights = COMPONENT_WEIGHTS.WHEEL_HUBS;

      expect(weights).toBeDefined();
      expect(weights!.wH).toBe(1.0); // hours weight
      expect(weights!.wD).toBe(0.2); // low distance weight
      expect(weights!.wC).toBe(0.1); // low climbing weight
      expect(weights!.wV).toBe(0.1); // low steepness weight
    });

    it('should have weights for REAR_DERAILLEUR (hours-only)', () => {
      const weights = COMPONENT_WEIGHTS.REAR_DERAILLEUR;

      expect(weights).toBeDefined();
      expect(weights!.wH).toBe(1.0); // hours weight
      expect(weights!.wD).toBe(0.0); // no distance sensitivity
      expect(weights!.wC).toBe(0.0); // no climbing sensitivity
      expect(weights!.wV).toBe(0.0); // no steepness sensitivity
    });
  });

  describe('isTrackableComponent', () => {
    it('should return true for WHEEL_HUBS', () => {
      expect(isTrackableComponent('WHEEL_HUBS' as ComponentType)).toBe(true);
    });

    it('should return true for REAR_DERAILLEUR', () => {
      expect(isTrackableComponent('REAR_DERAILLEUR' as ComponentType)).toBe(true);
    });

    it('should return true for other trackable components', () => {
      expect(isTrackableComponent('FORK' as ComponentType)).toBe(true);
      expect(isTrackableComponent('SHOCK' as ComponentType)).toBe(true);
      expect(isTrackableComponent('BRAKE_PAD' as ComponentType)).toBe(true);
      expect(isTrackableComponent('CHAIN' as ComponentType)).toBe(true);
    });

    it('should return false for non-trackable components', () => {
      expect(isTrackableComponent('STEM' as ComponentType)).toBe(false);
      expect(isTrackableComponent('HANDLEBAR' as ComponentType)).toBe(false);
      expect(isTrackableComponent('SADDLE' as ComponentType)).toBe(false);
      expect(isTrackableComponent('RIMS' as ComponentType)).toBe(false);
    });
  });

  describe('getComponentWeights', () => {
    it('should return weights for WHEEL_HUBS', () => {
      const weights = getComponentWeights('WHEEL_HUBS' as ComponentType);

      expect(weights.wH).toBe(1.0);
      expect(weights.wD).toBe(0.2);
      expect(weights.wC).toBe(0.1);
      expect(weights.wV).toBe(0.1);
    });

    it('should return weights for REAR_DERAILLEUR', () => {
      const weights = getComponentWeights('REAR_DERAILLEUR' as ComponentType);

      expect(weights.wH).toBe(1.0);
      expect(weights.wD).toBe(0.0);
      expect(weights.wC).toBe(0.0);
      expect(weights.wV).toBe(0.0);
    });

    it('should return default weights for unknown component type', () => {
      const weights = getComponentWeights('UNKNOWN' as ComponentType);

      expect(weights.wH).toBe(1.0);
      expect(weights.wD).toBe(0.5);
      expect(weights.wC).toBe(0.3);
      expect(weights.wV).toBe(0.2);
    });
  });
});
