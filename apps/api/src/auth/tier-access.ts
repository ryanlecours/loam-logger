import type { SubscriptionTier, ComponentType, UserRole } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { FREE_LIGHT_COMPONENT_TYPES, TIER_LIMITS, TIER_DISPLAY_NAMES } from '@loam/shared';

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

/**
 * Check if user can create another bike given their current active count.
 */
export function canCreateBike(user: TierUser, currentActiveBikeCount: number): boolean {
  const tier = getEffectiveTier(user);
  const limit = TIER_LIMITS[tier].maxBikes;
  return currentActiveBikeCount < limit;
}

/**
 * Check if user's tier allows a specific component type.
 */
export function canUseComponentType(user: TierUser, componentType: ComponentType): boolean {
  const tier = getEffectiveTier(user);
  const allowed = TIER_LIMITS[tier].componentTypes;
  if (allowed === 'ALL') return true;
  return (allowed as readonly string[]).includes(componentType);
}

/**
 * Return the list of allowed component types for a user's tier.
 */
export function getAllowedComponentTypes(user: TierUser): ComponentType[] | 'ALL' {
  const tier = getEffectiveTier(user);
  const allowed = TIER_LIMITS[tier].componentTypes;
  if (allowed === 'ALL') return 'ALL';
  return [...allowed] as ComponentType[];
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
    throw new GraphQLError(
      `Your ${TIER_DISPLAY_NAMES[tier]} plan allows a maximum of ${TIER_LIMITS[tier].maxBikes} bike(s). Upgrade to Pro for unlimited bikes.`,
      { extensions: { code: 'TIER_LIMIT_EXCEEDED', tier, limit: TIER_LIMITS[tier].maxBikes } }
    );
  }
}

/**
 * Throws a GraphQLError if the user's tier doesn't allow the component type.
 */
export function requireComponentType(user: TierUser, componentType: ComponentType): void {
  requireNoDowngradePending(user);
  if (!canUseComponentType(user, componentType)) {
    throw new GraphQLError(
      `Your Free plan does not include ${componentType.replace(/_/g, ' ').toLowerCase()} tracking. Upgrade or refer a friend to unlock all components.`,
      {
        extensions: {
          code: 'TIER_COMPONENT_RESTRICTED',
          componentType,
          allowedTypes: FREE_LIGHT_COMPONENT_TYPES,
        },
      }
    );
  }
}
