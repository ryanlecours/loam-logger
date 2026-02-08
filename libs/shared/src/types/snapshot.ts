/**
 * Snapshot types for capturing immutable bike setup state.
 * Used by BikeNote to preserve setup history even when components are deleted.
 */

export interface SetupSnapshot {
  capturedAt: string; // ISO timestamp
  bikeSpecs: BikeSpecsSnapshot;
  slots: SlotSnapshot[];
}

export interface BikeSpecsSnapshot {
  travelForkMm: number | null;
  travelShockMm: number | null;
  isEbike: boolean;
  batteryWh: number | null;
  motorPowerW: number | null;
  motorTorqueNm: number | null;
  motorMaker: string | null;
  motorModel: string | null;
}

export interface SlotSnapshot {
  slotKey: string; // e.g., "FORK_NONE", "TIRES_FRONT"
  componentType: string;
  location: string;
  component: ComponentSnapshot | null;
}

export interface ComponentSnapshot {
  componentId: string; // Reference only, may be deleted later
  brand: string;
  model: string;
  isStock: boolean;
  hoursUsed: number;
  serviceDueAtHours: number | null;
  settings: SettingSnapshot[]; // Extensible key/value pairs
}

export interface SettingSnapshot {
  key: string;
  value: string;
  unit: string | null;
  label: string;
}
