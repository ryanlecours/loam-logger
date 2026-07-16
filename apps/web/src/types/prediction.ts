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

// Predictive fields (status, hoursRemaining, ridesRemainingEstimate,
// confidence, overallStatus, due counts) are Pro-only — the API serves null
// for free users. Raw usage fields are present for all tiers.
export interface ComponentPrediction {
  componentId: string;
  componentType: ComponentType;
  location: ComponentLocation;
  brand: string;
  model: string;
  status: PredictionStatus | null;
  hoursRemaining: number | null;
  ridesRemainingEstimate: number | null;
  confidence: ConfidenceLevel | null;
  currentHours: number;
  serviceIntervalHours: number;
  hoursSinceService: number;
  ridesSinceService: number;
  why: string | null;
  drivers: WearDriver[] | null;
}

// Pro-only LLM maintenance summary. Served by the API only for Pro users on
// non-trivial (non-ALL_GOOD) bikes with components; null in every other case
// (free tier, empty bike, trivial state, rate-limited, generation error).
export interface AdvisorSummary {
  text: string;
  generatedAt: string;
  modelVersion: string;
}

export interface BikePredictionSummary {
  bikeId: string;
  bikeName: string;
  components: ComponentPrediction[];
  priorityComponent: ComponentPrediction | null;
  overallStatus: PredictionStatus | null;
  dueNowCount: number | null;
  dueSoonCount: number | null;
  generatedAt: string;
  // Optional: only the dashboard BIKES query selects it (see graphql/bikes.ts).
  // Other prediction queries (Gear list, bike detail) deliberately omit it to
  // avoid triggering LLM calls for a value they don't render, so it's absent
  // (undefined) there rather than null.
  advisorSummary?: AdvisorSummary | null;
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
