import type { SubscriptionTier, ComponentType } from '@prisma/client';
import {
  getEffectiveTier,
  isProTier,
  canCreateBike,
  canUseComponentType,
  getAllowedComponentTypes,
  requireBikeCreation,
  requireComponentType,
  requireNoDowngradePending,
} from './tier-access';

type TierUser = { subscriptionTier: SubscriptionTier; isFoundingRider: boolean };

const freeLight: TierUser = { subscriptionTier: 'FREE_LIGHT', isFoundingRider: false };
const freeFull: TierUser = { subscriptionTier: 'FREE_FULL', isFoundingRider: false };
const pro: TierUser = { subscriptionTier: 'PRO', isFoundingRider: false };
const foundingLight: TierUser = { subscriptionTier: 'FREE_LIGHT', isFoundingRider: true };
const foundingFull: TierUser = { subscriptionTier: 'FREE_FULL', isFoundingRider: true };

describe('getEffectiveTier', () => {
  it('returns the stored tier for non-founding riders', () => {
    expect(getEffectiveTier(freeLight)).toBe('FREE_LIGHT');
    expect(getEffectiveTier(freeFull)).toBe('FREE_FULL');
    expect(getEffectiveTier(pro)).toBe('PRO');
  });

  it('returns PRO for founding riders regardless of stored tier', () => {
    expect(getEffectiveTier(foundingLight)).toBe('PRO');
    expect(getEffectiveTier(foundingFull)).toBe('PRO');
  });
});

describe('isProTier', () => {
  it('returns true for PRO users', () => {
    expect(isProTier(pro)).toBe(true);
  });

  it('returns true for founding riders on any tier', () => {
    expect(isProTier(foundingLight)).toBe(true);
    expect(isProTier(foundingFull)).toBe(true);
  });

  it('returns false for free tier users', () => {
    expect(isProTier(freeLight)).toBe(false);
    expect(isProTier(freeFull)).toBe(false);
  });
});

describe('canCreateBike', () => {
  it('allows FREE_LIGHT users to create their first bike', () => {
    expect(canCreateBike(freeLight, 0)).toBe(true);
  });

  it('blocks FREE_LIGHT users at the limit', () => {
    expect(canCreateBike(freeLight, 1)).toBe(false);
  });

  it('blocks FREE_FULL users at the limit', () => {
    expect(canCreateBike(freeFull, 1)).toBe(false);
  });

  it('allows PRO users unlimited bikes', () => {
    expect(canCreateBike(pro, 0)).toBe(true);
    expect(canCreateBike(pro, 10)).toBe(true);
    expect(canCreateBike(pro, 100)).toBe(true);
  });

  it('allows founding riders unlimited bikes regardless of stored tier', () => {
    expect(canCreateBike(foundingLight, 50)).toBe(true);
  });

  it('blocks at exactly the boundary (not off-by-one)', () => {
    expect(canCreateBike(freeLight, 0)).toBe(true);  // 0 < 1
    expect(canCreateBike(freeLight, 1)).toBe(false);  // 1 < 1 is false
  });
});

describe('canUseComponentType', () => {
  const allowed: ComponentType[] = ['FORK', 'SHOCK', 'BRAKE_PAD', 'PIVOT_BEARINGS'];
  const restricted: ComponentType[] = [
    'BRAKES', 'DRIVETRAIN', 'TIRES', 'WHEEL_HUBS', 'DROPPER', 'PEDALS',
    'CHAIN', 'CASSETTE', 'OTHER', 'STEM', 'HANDLEBAR', 'SADDLE',
    'SEATPOST', 'RIMS', 'CRANK', 'REAR_DERAILLEUR', 'BRAKE_ROTOR',
    'HEADSET', 'BOTTOM_BRACKET',
  ];

  it('allows FREE_LIGHT users to use permitted component types', () => {
    for (const type of allowed) {
      expect(canUseComponentType(freeLight, type)).toBe(true);
    }
  });

  it('blocks FREE_LIGHT users from restricted component types', () => {
    for (const type of restricted) {
      expect(canUseComponentType(freeLight, type)).toBe(false);
    }
  });

  it('allows FREE_FULL users to use all component types', () => {
    for (const type of [...allowed, ...restricted]) {
      expect(canUseComponentType(freeFull, type)).toBe(true);
    }
  });

  it('allows PRO users to use all component types', () => {
    for (const type of [...allowed, ...restricted]) {
      expect(canUseComponentType(pro, type)).toBe(true);
    }
  });

  it('allows founding riders to use all component types regardless of stored tier', () => {
    for (const type of restricted) {
      expect(canUseComponentType(foundingLight, type)).toBe(true);
    }
  });
});

describe('getAllowedComponentTypes', () => {
  it('returns specific list for FREE_LIGHT', () => {
    const result = getAllowedComponentTypes(freeLight);
    expect(result).toEqual(['FORK', 'SHOCK', 'BRAKE_PAD', 'PIVOT_BEARINGS']);
  });

  it('returns ALL for FREE_FULL', () => {
    expect(getAllowedComponentTypes(freeFull)).toBe('ALL');
  });

  it('returns ALL for PRO', () => {
    expect(getAllowedComponentTypes(pro)).toBe('ALL');
  });

  it('returns ALL for founding riders', () => {
    expect(getAllowedComponentTypes(foundingLight)).toBe('ALL');
  });
});

describe('requireBikeCreation', () => {
  it('does not throw when under the limit', () => {
    expect(() => requireBikeCreation(freeLight, 0)).not.toThrow();
  });

  it('throws GraphQLError with TIER_LIMIT_EXCEEDED when at limit', () => {
    expect(() => requireBikeCreation(freeLight, 1)).toThrow('maximum of 1 bike');
  });

  it('does not throw for founding riders at any count', () => {
    expect(() => requireBikeCreation(foundingLight, 100)).not.toThrow();
  });

  it('includes tier info in error extensions', () => {
    try {
      requireBikeCreation(freeFull, 1);
      fail('should have thrown');
    } catch (err: unknown) {
      const gqlErr = err as { extensions?: { code?: string; limit?: number } };
      expect(gqlErr.extensions?.code).toBe('TIER_LIMIT_EXCEEDED');
      expect(gqlErr.extensions?.limit).toBe(1);
    }
  });
});

describe('requireComponentType', () => {
  it('does not throw for allowed types on FREE_LIGHT', () => {
    expect(() => requireComponentType(freeLight, 'FORK')).not.toThrow();
    expect(() => requireComponentType(freeLight, 'SHOCK')).not.toThrow();
    expect(() => requireComponentType(freeLight, 'BRAKE_PAD')).not.toThrow();
    expect(() => requireComponentType(freeLight, 'PIVOT_BEARINGS')).not.toThrow();
  });

  it('throws for restricted types on FREE_LIGHT', () => {
    expect(() => requireComponentType(freeLight, 'CHAIN')).toThrow('does not include');
    expect(() => requireComponentType(freeLight, 'DRIVETRAIN')).toThrow('does not include');
  });

  it('does not throw for any type on FREE_FULL', () => {
    expect(() => requireComponentType(freeFull, 'CHAIN')).not.toThrow();
    expect(() => requireComponentType(freeFull, 'DRIVETRAIN')).not.toThrow();
  });

  it('does not throw for founding riders on restricted types', () => {
    expect(() => requireComponentType(foundingLight, 'CHAIN')).not.toThrow();
  });

  it('includes allowed types in error extensions', () => {
    try {
      requireComponentType(freeLight, 'CHAIN');
      fail('should have thrown');
    } catch (err: unknown) {
      const gqlErr = err as { extensions?: { code?: string; allowedTypes?: string[] } };
      expect(gqlErr.extensions?.code).toBe('TIER_COMPONENT_RESTRICTED');
      expect(gqlErr.extensions?.allowedTypes).toEqual(['FORK', 'SHOCK', 'BRAKE_PAD', 'PIVOT_BEARINGS']);
    }
  });
});

describe('requireNoDowngradePending', () => {
  it('does not throw when needsDowngradeSelection is false', () => {
    expect(() => requireNoDowngradePending({ ...pro, needsDowngradeSelection: false })).not.toThrow();
  });

  it('does not throw when needsDowngradeSelection is undefined', () => {
    expect(() => requireNoDowngradePending(freeLight)).not.toThrow();
  });

  it('throws DOWNGRADE_SELECTION_REQUIRED when needsDowngradeSelection is true', () => {
    try {
      requireNoDowngradePending({ ...freeLight, needsDowngradeSelection: true });
      fail('should have thrown');
    } catch (err: unknown) {
      const gqlErr = err as { extensions?: { code?: string } };
      expect(gqlErr.extensions?.code).toBe('DOWNGRADE_SELECTION_REQUIRED');
    }
  });
});

describe('requireBikeCreation blocks downgrade-pending users', () => {
  it('throws DOWNGRADE_SELECTION_REQUIRED even if bike limit is not hit', () => {
    expect(() => requireBikeCreation({ ...pro, needsDowngradeSelection: true }, 0)).toThrow('select a bike');
  });
});

describe('requireComponentType blocks downgrade-pending users', () => {
  it('throws DOWNGRADE_SELECTION_REQUIRED even for allowed types', () => {
    expect(() => requireComponentType({ ...pro, needsDowngradeSelection: true }, 'FORK')).toThrow('select a bike');
  });
});
