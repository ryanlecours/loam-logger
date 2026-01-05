import { useEffect, useMemo, useState } from 'react';
import { PreferencesContext, type HoursDisplayMode } from './PreferencesContext';

const STORAGE_KEY = 'loam-hours-display';

function getInitialHoursDisplay(): HoursDisplayMode {
  if (typeof window === 'undefined') return 'total';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'total' || saved === 'remaining') return saved;
  return 'total';
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [hoursDisplay, setHoursDisplayState] = useState<HoursDisplayMode>(getInitialHoursDisplay);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, hoursDisplay);
  }, [hoursDisplay]);

  const setHoursDisplay = (mode: HoursDisplayMode) => {
    setHoursDisplayState(mode);
  };

  const value = useMemo(
    () => ({
      hoursDisplay,
      setHoursDisplay,
    }),
    [hoursDisplay]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
