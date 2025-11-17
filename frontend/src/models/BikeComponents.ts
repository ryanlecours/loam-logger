export interface Fork {
  brand: string;
  model: string;
  travelMm: number;
  hoursSinceLastService: number;
  offsetMm?: number;
  damper?: string;
}

export interface Shock {
  brand: string;
  model: string;
  strokeMm: number;
  eyeToEyeMm: number;
  hoursSinceLastService: number;
  type?: 'coil' | 'air';
}

export interface Drivetrain {
  brand: string;
  speed: number;
  cassetteRange: string; // e.g. "10-52T"
  derailleur: string;
  shifter: string;
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
  hoursSinceLastService: number;
  notes?: string;
}

export type BikeComponentKey = 'fork' | 'shock' | 'dropper' | 'wheels' | 'pivotBearings';

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
};

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
