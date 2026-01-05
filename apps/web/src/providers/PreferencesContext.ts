import { createContext } from 'react';

export type HoursDisplayMode = 'total' | 'remaining';

export type PreferencesContextValue = {
  hoursDisplay: HoursDisplayMode;
  setHoursDisplay: (mode: HoursDisplayMode) => void;
};

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined
);
