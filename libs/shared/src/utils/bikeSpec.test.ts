import { deriveBikeSpec } from './bikeSpec';

describe('deriveBikeSpec', () => {
  describe('isEbike', () => {
    it('should be true when the bike is flagged as an e-bike', () => {
      expect(deriveBikeSpec({ isEbike: true }).isEbike).toBe(true);
    });

    it('should be false when the bike is flagged analog', () => {
      expect(deriveBikeSpec({ isEbike: false }).isEbike).toBe(false);
    });

    // The field is optional on BikeData so existing callers keep compiling, but
    // it must never surface as undefined on BikeSpec: isApplicable returns it
    // directly, and an undefined would make e-bike components neither clearly
    // applicable nor clearly excluded.
    it('should default to false when omitted', () => {
      expect(deriveBikeSpec({}).isEbike).toBe(false);
    });

    it('should default to false when null', () => {
      expect(deriveBikeSpec({ isEbike: null }).isEbike).toBe(false);
    });

    it('should always be a boolean', () => {
      expect(typeof deriveBikeSpec({}).isEbike).toBe('boolean');
    });

    it('should not be inferred from suspension or 99spokes data', () => {
      const spec = deriveBikeSpec(
        { travelForkMm: 160, travelShockMm: 150 },
        { fork: { make: 'Fox', model: '36' }, rearShock: { make: 'Fox', model: 'DPX2' } }
      );

      expect(spec.isEbike).toBe(false);
    });
  });

  describe('suspension detection', () => {
    it('should stay unaffected by the isEbike flag', () => {
      const analog = deriveBikeSpec({ travelForkMm: 160, travelShockMm: 150, isEbike: false });
      const ebike = deriveBikeSpec({ travelForkMm: 160, travelShockMm: 150, isEbike: true });

      expect(analog.hasFrontSuspension).toBe(ebike.hasFrontSuspension);
      expect(analog.hasRearSuspension).toBe(ebike.hasRearSuspension);
    });
  });
});
