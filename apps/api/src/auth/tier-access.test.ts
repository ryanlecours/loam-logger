import type { SubscriptionTier } from '@prisma/client';
import {
  getEffectiveTier,
  isProTier,
  canCreateBike,
  requireBikeCreation,
  requireNoDowngradePending,
} from './tier-access';

type TierUser = { subscriptionTier: SubscriptionTier; isFoundingRider: boolean };

const free: TierUser = { subscriptionTier: 'FREE', isFoundingRider: false };
const pro: TierUser = { subscriptionTier: 'PRO', isFoundingRider: false };
const foundingFree: TierUser = { subscriptionTier: 'FREE', isFoundingRider: true };

describe('getEffectiveTier', () => {
  it('returns the stored tier for non-founding riders', () => {
    expect(getEffectiveTier(free)).toBe('FREE');
    expect(getEffectiveTier(pro)).toBe('PRO');
  });

  it('returns PRO for founding riders regardless of stored tier', () => {
    expect(getEffectiveTier(foundingFree)).toBe('PRO');
  });

  it('returns PRO for admins regardless of stored tier', () => {
    expect(getEffectiveTier({ ...free, role: 'ADMIN' })).toBe('PRO');
  });
});

describe('isProTier', () => {
  it('returns true for PRO users', () => {
    expect(isProTier(pro)).toBe(true);
  });

  it('returns true for founding riders on any tier', () => {
    expect(isProTier(foundingFree)).toBe(true);
  });

  it('returns false for free tier users', () => {
    expect(isProTier(free)).toBe(false);
  });
});

describe('canCreateBike', () => {
  it('allows FREE users to create their first bike', () => {
    expect(canCreateBike(free, 0)).toBe(true);
  });

  it('blocks FREE users at the limit', () => {
    expect(canCreateBike(free, 1)).toBe(false);
  });

  it('allows PRO users unlimited bikes', () => {
    expect(canCreateBike(pro, 0)).toBe(true);
    expect(canCreateBike(pro, 10)).toBe(true);
    expect(canCreateBike(pro, 100)).toBe(true);
  });

  it('allows founding riders unlimited bikes regardless of stored tier', () => {
    expect(canCreateBike(foundingFree, 50)).toBe(true);
  });

  it('blocks at exactly the boundary (not off-by-one)', () => {
    expect(canCreateBike(free, 0)).toBe(true);  // 0 < 1
    expect(canCreateBike(free, 1)).toBe(false);  // 1 < 1 is false
  });

  it('falls back to FREE limits for a stale/unknown stored tier', () => {
    const stale = { subscriptionTier: 'FREE_LIGHT' as unknown as SubscriptionTier, isFoundingRider: false };
    expect(canCreateBike(stale, 0)).toBe(true);
    expect(canCreateBike(stale, 1)).toBe(false);
  });
});

describe('requireBikeCreation', () => {
  it('does not throw when under the limit', () => {
    expect(() => requireBikeCreation(free, 0)).not.toThrow();
  });

  it('throws GraphQLError with TIER_LIMIT_EXCEEDED when at limit', () => {
    expect(() => requireBikeCreation(free, 1)).toThrow('maximum of 1 bike');
  });

  it('does not throw for founding riders at any count', () => {
    expect(() => requireBikeCreation(foundingFree, 100)).not.toThrow();
  });

  it('includes tier info in error extensions', () => {
    try {
      requireBikeCreation(free, 1);
      fail('should have thrown');
    } catch (err: unknown) {
      const gqlErr = err as { extensions?: { code?: string; limit?: number } };
      expect(gqlErr.extensions?.code).toBe('TIER_LIMIT_EXCEEDED');
      expect(gqlErr.extensions?.limit).toBe(1);
    }
  });
});

describe('requireNoDowngradePending', () => {
  it('does not throw when needsDowngradeSelection is false', () => {
    expect(() => requireNoDowngradePending({ ...pro, needsDowngradeSelection: false })).not.toThrow();
  });

  it('does not throw when needsDowngradeSelection is undefined', () => {
    expect(() => requireNoDowngradePending(free)).not.toThrow();
  });

  it('throws DOWNGRADE_SELECTION_REQUIRED when needsDowngradeSelection is true', () => {
    try {
      requireNoDowngradePending({ ...free, needsDowngradeSelection: true });
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
