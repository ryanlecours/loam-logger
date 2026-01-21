import { createContext } from 'react';

export type HoursDisplayMode = 'total' | 'remaining';
export type PredictionMode = 'simple' | 'predictive';

export type PreferencesContextValue = {
  hoursDisplay: HoursDisplayMode;
  setHoursDisplay: (mode: HoursDisplayMode) => void;
  predictionMode: PredictionMode;
  setPredictionMode: (mode: PredictionMode) => void;
};

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined
);
