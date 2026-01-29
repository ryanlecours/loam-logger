import type { ComponentType, ComponentLocation } from '@prisma/client';
import type { ComponentWearWeights } from './types';

/** Algorithm version for cache keys */
export const ALGO_VERSION = 'v1';

/** Default cache TTL in seconds (30 minutes) */
export const DEFAULT_CACHE_TTL_SECONDS = 30 * 60;

// =============================================================================
// Status Thresholds (in hours)
// =============================================================================

/** Hours remaining threshold for DUE_NOW status */
export const DUE_NOW_THRESHOLD_HOURS = 2;

/** Hours remaining threshold for DUE_SOON status */
export const DUE_SOON_THRESHOLD_HOURS = 10;

// =============================================================================
// Confidence Thresholds
// =============================================================================

/** Minimum rides for HIGH confidence */
export const CONFIDENCE_HIGH_MIN_RIDES = 8;

/** Minimum hours for HIGH confidence */
export const CONFIDENCE_HIGH_MIN_HOURS = 12;

/** Minimum rides for MEDIUM confidence */
export const CONFIDENCE_MEDIUM_MIN_RIDES = 4;

/** Minimum hours for MEDIUM confidence */
export const CONFIDENCE_MEDIUM_MIN_HOURS = 6;

// =============================================================================
// Pro Adaptive Limits
// =============================================================================

/** Minimum wear ratio clamp (riding less intensely than baseline) */
export const WEAR_RATIO_MIN = 0.75;

/** Maximum wear ratio clamp (riding more intensely than baseline) */
export const WEAR_RATIO_MAX = 1.5;

/** Hard maximum extension ratio (never extend interval beyond 1.2x base) */
export const MAX_EXTENSION_RATIO = 1.2;

/** Baseline wear per hour (1.0 = neutral riding) */
export const BASELINE_WEAR_PER_HOUR = 1.0;

// =============================================================================
// Windowing Configuration
// =============================================================================

/** Target number of recent rides to use */
export const RECENT_RIDES_TARGET = 10;

/** Primary window: days to look back for recent rides */
export const PRIMARY_WINDOW_DAYS = 30;

/** Fallback window: extended days if not enough rides in primary window */
export const FALLBACK_WINDOW_DAYS = 90;

// =============================================================================
// Component Wear Weights
// From spec: wearUnits = wH*H + wD*(D/10) + wC*(C/3000) + wV*(V/300)
// =============================================================================

/**
 * Wear weights per component type.
 * wH = hours weight
 * wD = distance weight
 * wC = climbing weight
 * wV = vertical intensity (steepness) weight
 */
export const COMPONENT_WEIGHTS: Partial<Record<ComponentType, ComponentWearWeights>> = {
  // Brake components - high climbing/steepness sensitivity
  BRAKE_PAD: { wH: 0.8, wD: 0.2, wC: 1.2, wV: 1.2 },
  BRAKE_ROTOR: { wH: 0.6, wD: 0.2, wC: 1.0, wV: 1.4 },
  BRAKES: { wH: 0.7, wD: 0.3, wC: 0.8, wV: 0.9 }, // bleed interval

  // Drivetrain components - high distance/climbing sensitivity
  CHAIN: { wH: 1.0, wD: 1.2, wC: 0.5, wV: 0.1 },
  CASSETTE: { wH: 0.8, wD: 1.0, wC: 0.6, wV: 0.1 }, // drivetrain wear
  DRIVETRAIN: { wH: 1.1, wD: 0.9, wC: 0.2, wV: 0.0 }, // clean/lube

  // Tires - balanced with distance emphasis
  TIRES: { wH: 0.7, wD: 1.0, wC: 0.4, wV: 0.8 },

  // Suspension - high hours sensitivity
  FORK: { wH: 1.3, wD: 0.3, wC: 0.2, wV: 0.1 },
  SHOCK: { wH: 1.2, wD: 0.3, wC: 0.2, wV: 0.1 },

  // Dropper post - hours dominant
  DROPPER: { wH: 1.2, wD: 0.2, wC: 0.1, wV: 0.0 },

  // Bearings - mixed sensitivity
  PIVOT_BEARINGS: { wH: 1.0, wD: 0.2, wC: 0.8, wV: 0.5 },
  HEADSET: { wH: 0.9, wD: 0.2, wC: 0.3, wV: 0.7 },
  BOTTOM_BRACKET: { wH: 1.0, wD: 0.8, wC: 0.5, wV: 0.1 },
};

/** Default weights for component types not in the map */
export const DEFAULT_WEIGHTS: ComponentWearWeights = {
  wH: 1.0,
  wD: 0.5,
  wC: 0.3,
  wV: 0.2,
};

// =============================================================================
// Base Service Intervals (in hours)
// =============================================================================

/** Service intervals that vary by location (front/rear) */
export interface LocationBasedInterval {
  front: number;
  rear: number;
}

/** Base service intervals per component type */
export const BASE_INTERVALS_HOURS: Partial<
  Record<ComponentType, number | LocationBasedInterval>
> = {
  BRAKE_PAD: { front: 40, rear: 35 },
  BRAKE_ROTOR: { front: 200, rear: 200 },
  BRAKES: { front: 100, rear: 100 }, // bleed interval - same for both but now paired
  CHAIN: 70,
  CASSETTE: 200,
  TIRES: { front: 120, rear: 100 },
  FORK: 50, // lowers service
  SHOCK: 50, // air can service
  DRIVETRAIN: 6, // clean/lube interval
  DROPPER: 150,
  PIVOT_BEARINGS: 250,
  HEADSET: 250,
  BOTTOM_BRACKET: 250,
};

/** Default interval for component types not in the map */
export const DEFAULT_INTERVAL_HOURS = 100;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get wear weights for a component type.
 */
export function getComponentWeights(type: ComponentType): ComponentWearWeights {
  return COMPONENT_WEIGHTS[type] ?? DEFAULT_WEIGHTS;
}

/**
 * Get base service interval for a component.
 * Uses location to select front/rear interval if applicable.
 */
export function getBaseInterval(
  type: ComponentType,
  location: ComponentLocation
): number {
  const interval = BASE_INTERVALS_HOURS[type];

  if (interval === undefined) {
    return DEFAULT_INTERVAL_HOURS;
  }

  if (typeof interval === 'number') {
    return interval;
  }

  // Location-based interval
  if (location === 'FRONT') {
    return interval.front;
  }
  if (location === 'REAR') {
    return interval.rear;
  }

  // Default to front interval if location is NONE
  return interval.front;
}

/**
 * Check if a component type is trackable for prediction.
 * Only components with defined weights are tracked.
 */
export function isTrackableComponent(type: ComponentType): boolean {
  return type in COMPONENT_WEIGHTS;
}

/**
 * Get all trackable component types.
 */
export function getTrackableComponentTypes(): ComponentType[] {
  return Object.keys(COMPONENT_WEIGHTS) as ComponentType[];
}
