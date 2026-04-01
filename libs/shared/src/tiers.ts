export const FREE_LIGHT_COMPONENT_TYPES = [
  'FORK',
  'SHOCK',
  'BRAKE_PAD',
  'PIVOT_BEARINGS',
] as const;

export type FreeLightComponentType = (typeof FREE_LIGHT_COMPONENT_TYPES)[number];

export const TIER_LIMITS = {
  FREE_LIGHT: { maxBikes: 1, componentTypes: FREE_LIGHT_COMPONENT_TYPES },
  FREE_FULL: { maxBikes: 1, componentTypes: 'ALL' as const },
  PRO: { maxBikes: Infinity, componentTypes: 'ALL' as const },
} as const;

export type SubscriptionTierName = keyof typeof TIER_LIMITS;

/** User-facing display names for each tier */
export const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  FREE_LIGHT: 'Free',
  FREE_FULL: 'Free',
  PRO: 'Pro',
} as const;

/** User-facing analysis level names */
export const ANALYSIS_LEVEL_NAMES: Record<SubscriptionTierName, string> = {
  FREE_LIGHT: 'Light Bike Analysis',
  FREE_FULL: 'Full Bike Analysis',
  PRO: 'Full Bike Analysis',
} as const;
