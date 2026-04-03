import { isFreeLightComponent, FREE_LIGHT_COMPONENT_TYPES } from './tiers';

describe('isFreeLightComponent', () => {
  it.each([...FREE_LIGHT_COMPONENT_TYPES])('returns true for allowed type %s', (type) => {
    expect(isFreeLightComponent(type)).toBe(true);
  });

  it.each(['CHAIN', 'CASSETTE', 'DRIVETRAIN', 'TIRES', 'BRAKES', 'HEADSET'])(
    'returns false for restricted type %s',
    (type) => {
      expect(isFreeLightComponent(type)).toBe(false);
    },
  );

  it('returns false for empty string', () => {
    expect(isFreeLightComponent('')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isFreeLightComponent('fork')).toBe(false);
    expect(isFreeLightComponent('Fork')).toBe(false);
  });
});
