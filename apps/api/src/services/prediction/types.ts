import type {
  ComponentType,
  ComponentLocation,
  UserRole,
} from '@prisma/client';

/** Prediction status levels */
export type PredictionStatus = 'ALL_GOOD' | 'DUE_SOON' | 'DUE_NOW' | 'OVERDUE';

/** Confidence levels */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

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
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
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

  // Current state
  currentHours: number;
  serviceIntervalHours: number;
  hoursSinceService: number;

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
}

/** Engine options */
export interface PredictionEngineOptions {
  userId: string;
  bikeId: string;
  userRole: UserRole;
  forceRefresh?: boolean;
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
