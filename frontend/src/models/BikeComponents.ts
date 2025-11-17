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

