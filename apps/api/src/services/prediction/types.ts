import type {
  ComponentType,
  ComponentLocation,
  UserRole,
} from '@prisma/client';

/** Prediction status levels */
export type PredictionStatus = 'ALL_GOOD' | 'DUE_SOON' | 'DUE_NOW' | 'OVERDUE';

/** Confidence levels */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** Prediction mode preference */
export type PredictionMode = 'simple' | 'predictive';

/** Wear factor types */
export type WearFactor = 'hours' | 'distance' | 'climbing' | 'steepness';

/** Wear driver for explanation */
export interface WearDriver {
  factor: WearFactor;
  contribution: number; // Percentage of total wear (0-100)
  label: string; // Human-readable label
}

/** Component-specific wear weights */
export interface ComponentWearWeights {
  wH: number; // Hours weight
  wD: number; // Distance weight
  wC: number; // Climbing weight
  wV: number; // Vertical intensity (steepness) weight
}

/** Ride metrics needed for wear calculation */
export interface RideMetrics {
  /** Ride id — used to apply per-component ride adjustments (exclude/include). */
  id: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  startTime: Date;
}

/** Component prediction result */
export interface ComponentPrediction {
  componentId: string;
  componentType: ComponentType;
  location: ComponentLocation;
  brand: string;
  model: string;

  // Core prediction
  status: PredictionStatus;
  hoursRemaining: number;
  ridesRemainingEstimate: number;
  confidence: ConfidenceLevel;

  // Current state (raw usage — served to all tiers)
  currentHours: number;
  serviceIntervalHours: number;
  hoursSinceService: number;
  ridesSinceService: number;

  /**
   * Lifetime hours: every counted ride across every bike this part has been
   * fitted to, plus its declared pre-Loam hours. `currentHours` is the
   * since-service figure, which for a part that has moved bikes or arrived
   * used is a much smaller number.
   */
  lifetimeHours: number;

  /**
   * The service clock on its own. `status` above is the headline — the worse of
   * this and `inspectionStatus` — so that a component still shows exactly one
   * health state, per PRODUCT.md's "is the bike good to go" test.
   */
  serviceStatus: PredictionStatus;

  /**
   * The inspection clock. Null when this component type is not
   * inspection-tracked (most are service-only), which is a different statement
   * from "inspection is fine" and must not render as an ALL_GOOD badge.
   */
  inspectionStatus: PredictionStatus | null;
  inspectionIntervalHours: number | null;
  hoursSinceInspection: number | null;
  inspectionHoursRemaining: number | null;

  /** Which clock produced `status`. Lets a surface say *why* a part is due. */
  limitingClock: 'SERVICE' | 'INSPECTION';

  // Pro-only explanation fields (null for FREE tier)
  why: string | null;
  drivers: WearDriver[] | null;
}

/** Bike-level prediction summary */
export interface BikePredictionSummary {
  bikeId: string;
  bikeName: string;
  components: ComponentPrediction[];
  priorityComponent: ComponentPrediction | null;
  overallStatus: PredictionStatus;
  dueNowCount: number;
  dueSoonCount: number;
  generatedAt: Date;
  algoVersion: string;
}

/** Cache key parameters */
export interface PredictionCacheKey {
  userId: string;
  bikeId: string;
  algoVersion: string;
  planTier: 'FREE' | 'PRO';
  predictionMode: PredictionMode;
}

/** Engine options */
export interface PredictionEngineOptions {
  userId: string;
  bikeId: string;
  userRole: UserRole;
  predictionMode: PredictionMode;
  forceRefresh?: boolean;
  /** When provided, overrides userRole-based Pro check */
  isFoundingRider?: boolean;
  subscriptionTier?: 'FREE' | 'PRO';
}

/** Internal component data with service info */
export interface ComponentWithService {
  id: string;
  type: ComponentType;
  location: ComponentLocation;
  brand: string;
  model: string;
  hoursUsed: number;
  serviceDueAtHours: number | null;
  lastServiceAt: Date | null;
}

/** Wear calculation result */
export interface WearCalculationResult {
  totalWearUnits: number;
  totalHours: number;
  breakdown: {
    hours: number;
    distance: number;
    climbing: number;
    steepness: number;
  };
}
