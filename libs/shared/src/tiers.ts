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
