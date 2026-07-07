import type { SubscriptionTier, UserRole } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { TIER_LIMITS, TIER_DISPLAY_NAMES, BIKE_LIMIT_UPSELL_LINE } from '@loam/shared';

type TierUser = {
  subscriptionTier: SubscriptionTier;
  isFoundingRider: boolean;
  needsDowngradeSelection?: boolean;
  role?: UserRole;
};

/**
 * Returns the effective tier, accounting for founding riders and admins who always get PRO.
 */
export function getEffectiveTier(user: TierUser): SubscriptionTier {
  if (user.isFoundingRider || user.role === 'ADMIN') return 'PRO';
  return user.subscriptionTier;
}

/**
 * Check if user has PRO-level access (paid Pro or founding rider).
 */
export function isProTier(user: TierUser): boolean {
  return getEffectiveTier(user) === 'PRO';
}

/** Weather info (per-ride display, breakdowns, backfill) is Pro-only. */
export function canSeeWeather(user: TierUser): boolean {
  return isProTier(user);
}

/** Rides/hours-remaining service predictions are Pro-only. */
export function canSeePredictions(user: TierUser): boolean {
  return isProTier(user);
}

/**
 * Historical import depth is tier-gated: free users may backfill only the
 * current year ('ytd', an omitted year, or the current year number); Pro
 * unlocks any past season. Rolling `days` windows are not gated — they are
 * already capped at 365 days by the routes.
 */
export function canBackfillYear(user: TierUser, yearParam: string | undefined): boolean {
  if (isProTier(user)) return true;
  if (yearParam === undefined || yearParam === 'ytd') return true;
  return parseInt(yearParam, 10) === new Date().getFullYear();
}

/**
 * Throws NOT_PRO if the user is not on the Pro tier.
 * `feature` names the capability in the error message, e.g. "Weather backfill".
 */
export function requirePro(user: TierUser, feature: string): void {
  if (!isProTier(user)) {
    throw new GraphQLError(`${feature} is a Pro feature.`, {
      extensions: { code: 'NOT_PRO' },
    });
  }
}

/** Limits for a tier, falling back to FREE for any stale enum value mid-deploy. */
function limitsFor(tier: SubscriptionTier) {
  return TIER_LIMITS[tier as keyof typeof TIER_LIMITS] ?? TIER_LIMITS.FREE;
}

/**
 * Check if user can create another bike given their current active count.
 */
export function canCreateBike(user: TierUser, currentActiveBikeCount: number): boolean {
  const tier = getEffectiveTier(user);
  const limit = limitsFor(tier).maxBikes;
  return currentActiveBikeCount < limit;
}

/**
 * Throws a GraphQLError if the user must select a bike after a downgrade.
 * Call this before any tier-gated mutation to block usage until selection is made.
 */
export function requireNoDowngradePending(user: TierUser): void {
  if (user.needsDowngradeSelection) {
    throw new GraphQLError(
      'Please select a bike to keep before continuing.',
      { extensions: { code: 'DOWNGRADE_SELECTION_REQUIRED' } }
    );
  }
}

/**
 * Throws a GraphQLError if the user has hit their bike creation limit.
 */
export function requireBikeCreation(user: TierUser, currentActiveBikeCount: number): void {
  requireNoDowngradePending(user);
  if (!canCreateBike(user, currentActiveBikeCount)) {
    const tier = getEffectiveTier(user);
    const displayName = TIER_DISPLAY_NAMES[tier as keyof typeof TIER_DISPLAY_NAMES] ?? 'Free';
    throw new GraphQLError(
      `Your ${displayName} plan covers ${limitsFor(tier).maxBikes} bike. ${BIKE_LIMIT_UPSELL_LINE}`,
      { extensions: { code: 'TIER_LIMIT_EXCEEDED', tier, limit: limitsFor(tier).maxBikes } }
    );
  }
}
