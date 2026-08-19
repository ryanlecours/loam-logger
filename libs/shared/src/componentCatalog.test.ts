import {
  PAIRED_COMPONENT_TYPES,
  requiresPairing,
  getPairedComponentDefinitions,
  getComponentByType,
  getApplicableComponents,
  getEbikeOnlyComponentTypes,
  isEbikeOnlyComponent,
  isHoursOnlyComponent,
  COMPONENT_CATALOG,
} from './componentCatalog';

describe('componentCatalog', () => {
  describe('PAIRED_COMPONENT_TYPES', () => {
    it('should include TIRES', () => {
      expect(PAIRED_COMPONENT_TYPES).toContain('TIRES');
    });

    it('should include BRAKE_PAD', () => {
      expect(PAIRED_COMPONENT_TYPES).toContain('BRAKE_PAD');
    });

    it('should include BRAKE_ROTOR', () => {
      expect(PAIRED_COMPONENT_TYPES).toContain('BRAKE_ROTOR');
    });

    it('should include BRAKES', () => {
      expect(PAIRED_COMPONENT_TYPES).toContain('BRAKES');
    });

    it('should have exactly 4 paired component types', () => {
      expect(PAIRED_COMPONENT_TYPES).toHaveLength(4);
    });
  });

  describe('requiresPairing', () => {
    it('should return true for TIRES', () => {
      expect(requiresPairing('TIRES')).toBe(true);
    });

    it('should return true for BRAKE_PAD', () => {
      expect(requiresPairing('BRAKE_PAD')).toBe(true);
    });

    it('should return true for BRAKE_ROTOR', () => {
      expect(requiresPairing('BRAKE_ROTOR')).toBe(true);
    });

    it('should return true for BRAKES', () => {
      expect(requiresPairing('BRAKES')).toBe(true);
    });

    it('should return false for FORK', () => {
      expect(requiresPairing('FORK')).toBe(false);
    });

    it('should return false for SHOCK', () => {
      expect(requiresPairing('SHOCK')).toBe(false);
    });

    it('should return false for CHAIN', () => {
      expect(requiresPairing('CHAIN')).toBe(false);
    });

    it('should return false for CASSETTE', () => {
      expect(requiresPairing('CASSETTE')).toBe(false);
    });

    it('should return false for DROPPER', () => {
      expect(requiresPairing('DROPPER')).toBe(false);
    });

    it('should return false for unknown component type', () => {
      expect(requiresPairing('UNKNOWN_TYPE')).toBe(false);
    });
  });

  describe('getPairedComponentDefinitions', () => {
    it('should return all components with requiresPairing=true', () => {
      const pairedDefs = getPairedComponentDefinitions();

      expect(pairedDefs.length).toBe(4);
      expect(pairedDefs.every((def) => def.requiresPairing === true)).toBe(true);
    });

    it('should include TIRES definition', () => {
      const pairedDefs = getPairedComponentDefinitions();
      const tiresDef = pairedDefs.find((def) => def.type === 'TIRES');

      expect(tiresDef).toBeDefined();
      expect(tiresDef?.supportsLocation).toBe(true);
    });

    it('should include BRAKE_PAD definition', () => {
      const pairedDefs = getPairedComponentDefinitions();
      const brakePadDef = pairedDefs.find((def) => def.type === 'BRAKE_PAD');

      expect(brakePadDef).toBeDefined();
      expect(brakePadDef?.supportsLocation).toBe(true);
    });

    it('should include BRAKE_ROTOR definition', () => {
      const pairedDefs = getPairedComponentDefinitions();
      const brakeRotorDef = pairedDefs.find((def) => def.type === 'BRAKE_ROTOR');

      expect(brakeRotorDef).toBeDefined();
      expect(brakeRotorDef?.supportsLocation).toBe(true);
    });

    it('should include BRAKES definition', () => {
      const pairedDefs = getPairedComponentDefinitions();
      const brakesDef = pairedDefs.find((def) => def.type === 'BRAKES');

      expect(brakesDef).toBeDefined();
      expect(brakesDef?.supportsLocation).toBe(true);
    });
  });

  describe('paired components in COMPONENT_CATALOG', () => {
    it('TIRES should have requiresPairing=true and supportsLocation=true', () => {
      const tiresDef = getComponentByType('TIRES');

      expect(tiresDef).toBeDefined();
      expect(tiresDef?.requiresPairing).toBe(true);
      expect(tiresDef?.supportsLocation).toBe(true);
    });

    it('BRAKE_PAD should have requiresPairing=true and supportsLocation=true', () => {
      const brakePadDef = getComponentByType('BRAKE_PAD');

      expect(brakePadDef).toBeDefined();
      expect(brakePadDef?.requiresPairing).toBe(true);
      expect(brakePadDef?.supportsLocation).toBe(true);
    });

    it('BRAKE_ROTOR should have requiresPairing=true and supportsLocation=true', () => {
      const brakeRotorDef = getComponentByType('BRAKE_ROTOR');

      expect(brakeRotorDef).toBeDefined();
      expect(brakeRotorDef?.requiresPairing).toBe(true);
      expect(brakeRotorDef?.supportsLocation).toBe(true);
    });

    it('BRAKES should have requiresPairing=true and supportsLocation=true', () => {
      const brakesDef = getComponentByType('BRAKES');

      expect(brakesDef).toBeDefined();
      expect(brakesDef?.requiresPairing).toBe(true);
      expect(brakesDef?.supportsLocation).toBe(true);
    });

    it('non-paired components should not have requiresPairing=true', () => {
      const nonPairedTypes = ['FORK', 'SHOCK', 'CHAIN', 'CASSETTE', 'DROPPER', 'PEDALS'];

      for (const type of nonPairedTypes) {
        const def = getComponentByType(type);
        expect(def?.requiresPairing).not.toBe(true);
      }
    });
  });

  describe('component catalog consistency', () => {
    it('all paired components should also support location', () => {
      const pairedDefs = COMPONENT_CATALOG.filter((def) => def.requiresPairing === true);

      for (const def of pairedDefs) {
        expect(def.supportsLocation).toBe(true);
      }
    });

    it('PAIRED_COMPONENT_TYPES should match catalog definitions', () => {
      for (const type of PAIRED_COMPONENT_TYPES) {
        const def = getComponentByType(type);
        expect(def).toBeDefined();
        expect(def?.requiresPairing).toBe(true);
      }
    });
  });

  describe('WHEEL_HUBS component definition', () => {
    it('should have WHEEL_HUBS in catalog', () => {
      const def = getComponentByType('WHEEL_HUBS');

      expect(def).toBeDefined();
      expect(def?.displayName).toBe('Wheel Hubs');
      expect(def?.category).toBe('WHEELS');
    });

    it('should have correct service interval for hub bearing service', () => {
      const def = getComponentByType('WHEEL_HUBS');

      expect(def?.serviceIntervalHours).toBe(250);
    });

    it('should map to wheels spokesKey for 99spokes import compatibility', () => {
      const def = getComponentByType('WHEEL_HUBS');

      expect(def?.spokesKey).toBe('wheels');
    });

    it('should be applicable to all bikes', () => {
      const def = getComponentByType('WHEEL_HUBS');

      expect(def?.isApplicable({ hasFrontSuspension: false, hasRearSuspension: false, isEbike: false })).toBe(true);
      expect(def?.isApplicable({ hasFrontSuspension: true, hasRearSuspension: true, isEbike: false })).toBe(true);
    });

    it('should not require pairing', () => {
      const def = getComponentByType('WHEEL_HUBS');

      expect(def?.requiresPairing).not.toBe(true);
    });
  });

  describe('REAR_DERAILLEUR component definition', () => {
    it('should have REAR_DERAILLEUR in catalog', () => {
      const def = getComponentByType('REAR_DERAILLEUR');

      expect(def).toBeDefined();
      expect(def?.displayName).toBe('Rear Derailleur');
      expect(def?.category).toBe('DRIVETRAIN');
    });

    it('should have correct service interval for cable/housing replacement', () => {
      const def = getComponentByType('REAR_DERAILLEUR');

      expect(def?.serviceIntervalHours).toBe(200);
    });

    it('should map to rearDerailleur spokesKey', () => {
      const def = getComponentByType('REAR_DERAILLEUR');

      expect(def?.spokesKey).toBe('rearDerailleur');
    });

    it('should be applicable to all bikes', () => {
      const def = getComponentByType('REAR_DERAILLEUR');

      expect(def?.isApplicable({ hasFrontSuspension: false, hasRearSuspension: false, isEbike: false })).toBe(true);
    });

    it('should not require pairing', () => {
      const def = getComponentByType('REAR_DERAILLEUR');

      expect(def?.requiresPairing).not.toBe(true);
    });
  });

  describe('EBIKE component definitions', () => {
    const ANALOG = { hasFrontSuspension: true, hasRearSuspension: true, isEbike: false };
    const EBIKE = { hasFrontSuspension: true, hasRearSuspension: true, isEbike: true };

    it.each(['MOTOR', 'BATTERY'])('should have %s in the catalog under EBIKE', (type) => {
      const def = getComponentByType(type);

      expect(def).toBeDefined();
      expect(def?.category).toBe('EBIKE');
    });

    it.each(['MOTOR', 'BATTERY'])('should apply %s to e-bikes only', (type) => {
      const def = getComponentByType(type);

      expect(def?.isApplicable(EBIKE)).toBe(true);
      expect(def?.isApplicable(ANALOG)).toBe(false);
    });

    it.each(['MOTOR', 'BATTERY'])('should mark %s hours-only', (type) => {
      expect(getComponentByType(type)?.hoursOnly).toBe(true);
      expect(isHoursOnlyComponent(type)).toBe(true);
    });

    it.each(['MOTOR', 'BATTERY'])('should flag %s as e-bike only', (type) => {
      expect(isEbikeOnlyComponent(type)).toBe(true);
    });

    it('should derive the e-bike-only list from the catalog', () => {
      expect(getEbikeOnlyComponentTypes().sort()).toEqual(['BATTERY', 'MOTOR']);
    });

    it('should not require pairing', () => {
      expect(getComponentByType('MOTOR')?.requiresPairing).not.toBe(true);
      expect(getComponentByType('BATTERY')?.requiresPairing).not.toBe(true);
    });

    it('should exclude e-bike components from an analog build', () => {
      const types = getApplicableComponents(ANALOG).map((c) => c.type);

      expect(types).not.toContain('MOTOR');
      expect(types).not.toContain('BATTERY');
    });

    it('should include e-bike components in an e-bike build', () => {
      const types = getApplicableComponents(EBIKE).map((c) => c.type);

      expect(types).toContain('MOTOR');
      expect(types).toContain('BATTERY');
    });

    it('should leave every non-e-bike component unaffected by the isEbike flag', () => {
      const analog = getApplicableComponents(ANALOG).map((c) => c.type);
      const ebike = getApplicableComponents(EBIKE).map((c) => c.type).filter((t) => t !== 'MOTOR' && t !== 'BATTERY');

      expect(ebike).toEqual(analog);
    });

    it('should treat every other catalog entry as wear-modelled, not hours-only', () => {
      const hoursOnly = COMPONENT_CATALOG.filter((c) => c.hoursOnly).map((c) => c.type).sort();

      expect(hoursOnly).toEqual(['BATTERY', 'MOTOR']);
    });
  });
});
