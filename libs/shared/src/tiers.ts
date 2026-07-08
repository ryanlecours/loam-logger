export const TIER_LIMITS = {
  FREE: { maxBikes: 1, componentTypes: 'ALL' as const },
  PRO: { maxBikes: Infinity, componentTypes: 'ALL' as const },
} as const;

export type SubscriptionTierName = keyof typeof TIER_LIMITS;

/** User-facing display names for each tier */
export const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  FREE: 'Free',
  PRO: 'Pro',
} as const;

/**
 * The n+1 upsell line shown when a free account hits the bike limit.
 * Single source for the API error message and the web upsell copy map
 * (apps/web/src/constants/upsellCopy.ts); the mobile repo mirrors it in
 * its own upsellCopy.ts — keep in sync.
 */
export const BIKE_LIMIT_UPSELL_LINE =
  'The correct number of bikes is always one more — track the whole quiver with Pro.';
