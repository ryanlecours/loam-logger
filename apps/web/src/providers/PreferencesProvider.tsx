import { useEffect, useMemo, useState, useRef } from 'react';
import { PreferencesContext, type HoursDisplayMode } from './PreferencesContext';
import { useViewer } from '../graphql/me';

const STORAGE_KEY = 'loam-hours-display';

function getInitialHoursDisplay(): HoursDisplayMode {
  if (typeof window === 'undefined') return 'total';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'total' || saved === 'remaining') return saved;
  return 'total';
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [hoursDisplay, setHoursDisplayState] = useState<HoursDisplayMode>(getInitialHoursDisplay);
  const { viewer } = useViewer();
  const hasSyncedFromDb = useRef(false);

  // Sync from database preference when user data loads (only once per session)
  useEffect(() => {
    if (viewer?.hoursDisplayPreference && !hasSyncedFromDb.current) {
      const dbPref = viewer.hoursDisplayPreference as HoursDisplayMode;
      if (dbPref === 'total' || dbPref === 'remaining') {
        setHoursDisplayState(dbPref);
        hasSyncedFromDb.current = true;
      }
    }
  }, [viewer?.hoursDisplayPreference]);

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
