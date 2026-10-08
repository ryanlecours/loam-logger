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

  /** The service clock's state. Health is the service clock alone, so it equals `status`. */
  serviceStatus: PredictionStatus;

  /**
   * When an inspection standing in for a service started the current cycle,
   * the hours it granted before the next service; null otherwise.
   */
  serviceExtensionHours: number | null;

  /** The extension Loam suggests for an inspection logged now: half the interval. */
  recommendedExtensionHours: number;

  /**
   * Always null. Inspections are optional stand-ins for a due service, not a
   * schedule of their own, so there is no inspection clock to report. Kept so
   * clients that request these fields keep working.
   */
  inspectionStatus: PredictionStatus | null;
  inspectionIntervalHours: number | null;
  hoursSinceInspection: number | null;
  inspectionHoursRemaining: number | null;

  /** Always 'SERVICE', for the same reason. */
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
