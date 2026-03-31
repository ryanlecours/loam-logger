import { createContext } from 'react';

export type HoursDisplayMode = 'total' | 'remaining';
export type PredictionMode = 'simple' | 'predictive';
export type DistanceUnit = 'mi' | 'km';

export type PreferencesContextValue = {
  hoursDisplay: HoursDisplayMode;
  setHoursDisplay: (mode: HoursDisplayMode) => void;
  predictionMode: PredictionMode;
  setPredictionMode: (mode: PredictionMode) => void;
  distanceUnit: DistanceUnit;
  setDistanceUnit: (unit: DistanceUnit) => void;
};

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined
);
