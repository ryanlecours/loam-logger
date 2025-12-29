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

export interface GearComponentState {
  brand: string;
  model: string;
  notes: string;
  isStock: boolean;
}

// 99spokes component data for auto-creation
export interface SpokesComponentData {
  maker?: string | null;
  model?: string | null;
  description?: string | null;
  kind?: string | null;  // For seatpost: 'dropper' | 'rigid'
}

export interface SpokesComponentsData {
  fork?: SpokesComponentData | null;
  rearShock?: SpokesComponentData | null;
  brakes?: SpokesComponentData | null;
  rearDerailleur?: SpokesComponentData | null;
  crank?: SpokesComponentData | null;
  cassette?: SpokesComponentData | null;
  rims?: SpokesComponentData | null;
  tires?: SpokesComponentData | null;
  stem?: SpokesComponentData | null;
  handlebar?: SpokesComponentData | null;
  saddle?: SpokesComponentData | null;
  seatpost?: SpokesComponentData | null;
}

export interface BikeFormValues {
  nickname: string;
  manufacturer: string;
  model: string;
  year: string;
  travelForkMm: string;
  travelShockMm: string;
  notes: string;
  spokesId?: string | null;
  selectedSize?: string;  // Frame size selected from 99spokes sizes
  // 99spokes metadata fields
  spokesUrl?: string | null;
  thumbnailUrl?: string | null;
  family?: string | null;
  category?: string | null;
  subcategory?: string | null;
  buildKind?: string | null;
  isFrameset?: boolean;
  isEbike?: boolean;
  gender?: string | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  // E-bike motor/battery specs
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
  // 99spokes components for auto-creation
  spokesComponents?: SpokesComponentsData | null;
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
