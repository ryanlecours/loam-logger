// Prediction engine types - matches API GraphQL schema

export type PredictionStatus = 'ALL_GOOD' | 'DUE_SOON' | 'DUE_NOW' | 'OVERDUE';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type ComponentType =
  | 'FORK'
  | 'SHOCK'
  | 'BRAKES'
  | 'DRIVETRAIN'
  | 'TIRES'
  | 'CHAIN'
  | 'CASSETTE'
  | 'CHAINRING'
  | 'WHEEL_HUBS'
  | 'DROPPER'
  | 'PIVOT_BEARINGS'
  | 'BRAKE_PAD'
  | 'BRAKE_ROTOR'
  | 'HEADSET'
  | 'BOTTOM_BRACKET'
  | 'REAR_DERAILLEUR';

export type ComponentLocation = 'FRONT' | 'REAR' | 'NONE';

export interface WearDriver {
  factor: string;
  contribution: number;
  label: string;
}

export interface ComponentPrediction {
  componentId: string;
  componentType: ComponentType;
  location: ComponentLocation;
  brand: string;
  model: string;
  status: PredictionStatus;
  hoursRemaining: number;
  ridesRemainingEstimate: number;
  confidence: ConfidenceLevel;
  currentHours: number;
  serviceIntervalHours: number;
  hoursSinceService: number;
  why: string | null;
  drivers: WearDriver[] | null;
}

export interface BikePredictionSummary {
  bikeId: string;
  bikeName: string;
  components: ComponentPrediction[];
  priorityComponent: ComponentPrediction | null;
  overallStatus: PredictionStatus;
  dueNowCount: number;
  dueSoonCount: number;
  generatedAt: string;
}

// Status severity ordering for sorting (higher = more urgent)
export const STATUS_SEVERITY: Record<PredictionStatus, number> = {
  OVERDUE: 4,
  DUE_NOW: 3,
  DUE_SOON: 2,
  ALL_GOOD: 1,
};

// Status display configuration
export const STATUS_CONFIG: Record<PredictionStatus, { label: string; colorVar: string }> = {
  OVERDUE: { label: 'Overdue', colorVar: '--status-overdue' },
  DUE_NOW: { label: 'Due Now', colorVar: '--status-due-now' },
  DUE_SOON: { label: 'Due Soon', colorVar: '--status-due-soon' },
  ALL_GOOD: { label: 'All Good', colorVar: '--status-all-good' },
};

// Confidence display configuration
export const CONFIDENCE_CONFIG: Record<ConfidenceLevel, { label: string; colorVar: string }> = {
  HIGH: { label: 'High', colorVar: '--confidence-high' },
  MEDIUM: { label: 'Med', colorVar: '--confidence-medium' },
  LOW: { label: 'Low', colorVar: '--confidence-low' },
};
