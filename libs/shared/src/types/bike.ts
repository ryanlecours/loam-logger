export interface Fork {
  id?: string;
  brand: string;
  model: string;
  travelMm: number;
  hoursSinceLastService: number;
  offsetMm?: number;
  damper?: string;
}

export interface Shock {
  id?: string;
  brand: string;
  model: string;
  strokeMm: number;
  eyeToEyeMm: number;
  hoursSinceLastService: number;
  type?: 'coil' | 'air';
}

export interface Drivetrain {
  id?: string;
  brand: string;
  speed: number;
  cassetteRange: string; // e.g. "10-52T"
  derailleur: string;
  shifter: string;
  hoursSinceLastService: number;
}

export interface WheelBearings {
  id?: string;
  brand: string;
  model: string;
  hoursSinceLastService: number;
}

export interface DropperPost {
  id?: string;
  brand: string;
  model: string;
  hoursSinceLastService: number;
}

export interface Bike {
  id: string;
  name: string;
  type: 'trail' | 'enduro' | 'downhill' | 'xc' | 'gravel';
  frameMaterial: 'carbon' | 'aluminum' | 'steel' | 'titanium';
  travelFrontMm: number;
  travelRearMm: number;
  fork: Fork;
  shock: Shock;
  drivetrain: Drivetrain;
  wheelBearings: WheelBearings;
  dropperPost: DropperPost;
  hoursSinceLastService: number;
  pivotBearingsId?: string;
  notes?: string;
}

export type BikeComponentKey = 'fork' | 'shock' | 'dropper' | 'wheels' | 'pivotBearings';

/**
 * All component types tracked in the system.
 * This is the single source of truth for component type definitions.
 */
export const ALL_COMPONENT_TYPES = [
  { key: 'fork', label: 'Fork', spokesKey: 'fork', dbType: 'FORK' },
  { key: 'rearShock', label: 'Rear Shock', spokesKey: 'rearShock', dbType: 'SHOCK' },
  { key: 'brakes', label: 'Brakes', spokesKey: 'brakes', dbType: 'BRAKES' },
  { key: 'rearDerailleur', label: 'Rear Derailleur', spokesKey: 'rearDerailleur', dbType: 'REAR_DERAILLEUR' },
  { key: 'crank', label: 'Crankset', spokesKey: 'crank', dbType: 'CRANK' },
  { key: 'cassette', label: 'Cassette', spokesKey: 'cassette', dbType: 'CASSETTE' },
  { key: 'rims', label: 'Rims', spokesKey: 'rims', dbType: 'RIMS' },
  { key: 'tires', label: 'Tires', spokesKey: 'tires', dbType: 'TIRES' },
  { key: 'stem', label: 'Stem', spokesKey: 'stem', dbType: 'STEM' },
  { key: 'handlebar', label: 'Handlebar', spokesKey: 'handlebar', dbType: 'HANDLEBAR' },
  { key: 'saddle', label: 'Saddle', spokesKey: 'saddle', dbType: 'SADDLE' },
  { key: 'seatpost', label: 'Seatpost', spokesKey: 'seatpost', dbType: 'SEATPOST' },
  { key: 'wheels', label: 'Wheels', spokesKey: 'wheels', dbType: 'WHEELS' },
  { key: 'pivotBearings', label: 'Pivot Bearings', spokesKey: null, dbType: 'PIVOT_BEARINGS' },
] as const;

export type ComponentTypeEntry = (typeof ALL_COMPONENT_TYPES)[number];

/**
 * Mapping from 99spokes API component keys to database ComponentType enum values.
 * Used when creating components from 99spokes data.
 */
export const SPOKES_TO_COMPONENT_TYPE: Record<string, string> = {
  fork: 'FORK',
  rearShock: 'SHOCK',
  brakes: 'BRAKES',
  rearDerailleur: 'REAR_DERAILLEUR',
  crank: 'CRANK',
  cassette: 'CASSETTE',
  rims: 'RIMS',
  tires: 'TIRES',
  stem: 'STEM',
  handlebar: 'HANDLEBAR',
  saddle: 'SADDLE',
  seatpost: 'SEATPOST',
};

export interface GearComponentState {
  brand: string;
  model: string;
  notes: string;
  isStock: boolean;
}

export interface BikeFormValues {
  nickname: string;
  manufacturer: string;
  model: string;
  year: string;
  travelForkMm: string;
  travelShockMm: string;
  notes: string;
  components: Record<BikeComponentKey, GearComponentState>;
}

export interface SpareFormState {
  id?: string;
  type: 'FORK' | 'SHOCK' | 'DROPPER' | 'WHEELS';
  brand: string;
  model: string;
  notes: string;
  isStock: boolean;
  hoursUsed: string;
  serviceDueAtHours: string;
}

export const BIKE_COMPONENT_SECTIONS: ReadonlyArray<{
  key: BikeComponentKey;
  label: string;
  type: string;
}> = [
  { key: 'fork', label: 'Fork', type: 'FORK' },
  { key: 'shock', label: 'Shock', type: 'SHOCK' },
  { key: 'dropper', label: 'Dropper Post', type: 'DROPPER' },
  { key: 'wheels', label: 'Wheels', type: 'WHEELS' },
  { key: 'pivotBearings', label: 'Pivot Bearings', type: 'PIVOT_BEARINGS' },
];

export type BikeComponentSection = (typeof BIKE_COMPONENT_SECTIONS)[number];

export type BikeFormProps = {
  mode: 'create' | 'edit';
  initial: BikeFormValues;
  submitting: boolean;
  error: string | null;
  onSubmit: (form: BikeFormValues) => void;
  onClose: () => void;
};

// ============================================================================
// Acquisition Condition & Baseline Types
// ============================================================================

/**
 * Acquisition condition for a bike - determines default baseline behavior.
 * - NEW: Brand new bike, all components start at 0% wear
 * - USED: Used bike with unknown history, default 50% wear
 * - MIXED: Some new, some used parts
 */
export type AcquisitionCondition = 'NEW' | 'USED' | 'MIXED';

/**
 * Method used to set the baseline wear for a component.
 * - DEFAULT: System default based on acquisition condition
 * - SLIDER: User estimated via wear slider
 * - DATES: Calculated from last service date
 */
export type BaselineMethod = 'DEFAULT' | 'SLIDER' | 'DATES';

/**
 * Confidence level for the baseline wear estimate.
 * - LOW: No data, using defaults (USED/MIXED bikes with no user input)
 * - MEDIUM: User estimated (slider input)
 * - HIGH: Based on actual data (NEW bike or date-based calculation)
 */
export type BaselineConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Baseline wear data for a component.
 */
export interface ComponentBaseline {
  /** Wear percentage (0-100), where 0 = just serviced, 100 = overdue */
  wearPercent: number;
  /** How the baseline was determined */
  method: BaselineMethod;
  /** Confidence level of the estimate */
  confidence: BaselineConfidence;
  /** When the component was last serviced (ISO date string) */
  lastServicedAt?: string;
}

/**
 * Wear percentage snap points for the baseline slider.
 * Used for discrete slider positions with meaningful labels.
 */
export const BASELINE_WEAR_SNAP_POINTS = [
  { value: 0, label: 'Just serviced' },
  { value: 25, label: 'Lightly used' },
  { value: 50, label: 'Mid-life' },
  { value: 75, label: 'Near service' },
  { value: 90, label: 'Overdue' },
] as const;

export type BaselineWearSnapPoint = (typeof BASELINE_WEAR_SNAP_POINTS)[number];
