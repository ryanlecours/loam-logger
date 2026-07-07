import { TIER_LIMITS, TIER_DISPLAY_NAMES } from './tiers';

describe('TIER_LIMITS', () => {
  it('limits Free accounts to a single bike with all component types', () => {
    expect(TIER_LIMITS.FREE.maxBikes).toBe(1);
    expect(TIER_LIMITS.FREE.componentTypes).toBe('ALL');
  });

  it('gives Pro accounts unlimited bikes with all component types', () => {
    expect(TIER_LIMITS.PRO.maxBikes).toBe(Infinity);
    expect(TIER_LIMITS.PRO.componentTypes).toBe('ALL');
  });

  it('has a display name for every tier', () => {
    for (const tier of Object.keys(TIER_LIMITS) as (keyof typeof TIER_LIMITS)[]) {
      expect(TIER_DISPLAY_NAMES[tier]).toBeTruthy();
    }
  });
});
