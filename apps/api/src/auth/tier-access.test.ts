import type { SubscriptionTier } from '@prisma/client';
import {
  getEffectiveTier,
  isProTier,
  canCreateBike,
  canBackfillYear,
  canSeeWeather,
  canSeePredictions,
  requirePro,
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
    expect(() => requireBikeCreation(free, 1)).toThrow('covers 1 bike');
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

describe('canSeeWeather / canSeePredictions', () => {
  // Both gates are defined as Pro-level access — they must agree with
  // isProTier for every kind of user.
  const stale: TierUser = {
    subscriptionTier: 'FREE_LIGHT' as unknown as SubscriptionTier,
    isFoundingRider: false,
  };

  it.each([
    ['free', free, false],
    ['pro', pro, true],
    ['founding rider on stored FREE', foundingFree, true],
    ['stale enum value (mid-deploy)', stale, false],
  ] as const)('%s → %s', (_label, user, expected) => {
    expect(canSeeWeather(user)).toBe(expected);
    expect(canSeePredictions(user)).toBe(expected);
  });

  it('grants access to admins regardless of stored tier', () => {
    const admin = { ...free, role: 'ADMIN' as const };
    expect(canSeeWeather(admin)).toBe(true);
    expect(canSeePredictions(admin)).toBe(true);
  });
});

describe('requirePro', () => {
  it('does not throw for Pro users, founding riders, or admins', () => {
    expect(() => requirePro(pro, 'Weather backfill')).not.toThrow();
    expect(() => requirePro(foundingFree, 'Weather backfill')).not.toThrow();
    expect(() => requirePro({ ...free, role: 'ADMIN' }, 'Weather backfill')).not.toThrow();
  });

  it('throws NOT_PRO with the feature name for free users', () => {
    try {
      requirePro(free, 'Predictive mode');
      fail('should have thrown');
    } catch (err: unknown) {
      const gqlErr = err as { message: string; extensions?: { code?: string } };
      expect(gqlErr.message).toBe('Predictive mode is a Pro feature.');
      expect(gqlErr.extensions?.code).toBe('NOT_PRO');
    }
  });

  it('throws for stale enum values rather than granting access', () => {
    const stale = { subscriptionTier: 'FREE_FULL' as unknown as SubscriptionTier, isFoundingRider: false };
    expect(() => requirePro(stale, 'Weather backfill')).toThrow('Weather backfill is a Pro feature.');
  });
});

describe('canBackfillYear', () => {
  const currentYear = String(new Date().getFullYear());

  it('allows Pro users to backfill any year', () => {
    expect(canBackfillYear(pro, '2019')).toBe(true);
    expect(canBackfillYear(pro, 'ytd')).toBe(true);
  });

  it('allows founding riders to backfill any year', () => {
    expect(canBackfillYear(foundingFree, '2020')).toBe(true);
  });

  it('allows free users to backfill the current year only', () => {
    expect(canBackfillYear(free, 'ytd')).toBe(true);
    expect(canBackfillYear(free, undefined)).toBe(true);
    expect(canBackfillYear(free, currentYear)).toBe(true);
  });

  it('blocks free users from past seasons', () => {
    expect(canBackfillYear(free, String(new Date().getFullYear() - 1))).toBe(false);
    expect(canBackfillYear(free, '2020')).toBe(false);
    expect(canBackfillYear(free, 'garbage')).toBe(false);
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
