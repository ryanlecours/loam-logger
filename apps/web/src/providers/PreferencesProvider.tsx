import { useEffect, useMemo, useState, useRef } from 'react';
import { PreferencesContext, type HoursDisplayMode, type PredictionMode, type DistanceUnit } from './PreferencesContext';
import { useViewer } from '../graphql/me';

const HOURS_STORAGE_KEY = 'loam-hours-display';
const PREDICTION_STORAGE_KEY = 'loam-prediction-mode';
const DISTANCE_UNIT_STORAGE_KEY = 'loam-distance-unit';

function getInitialHoursDisplay(): HoursDisplayMode {
  if (typeof window === 'undefined') return 'total';
  const saved = window.localStorage.getItem(HOURS_STORAGE_KEY);
  if (saved === 'total' || saved === 'remaining') return saved;
  return 'total';
}

function getInitialPredictionMode(): PredictionMode {
  if (typeof window === 'undefined') return 'simple';
  const saved = window.localStorage.getItem(PREDICTION_STORAGE_KEY);
  if (saved === 'simple' || saved === 'predictive') return saved;
  return 'simple';
}

function getInitialDistanceUnit(): DistanceUnit {
  if (typeof window === 'undefined') return 'mi';
  const saved = window.localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
  if (saved === 'mi' || saved === 'km') return saved;
  return 'mi';
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [hoursDisplay, setHoursDisplayState] = useState<HoursDisplayMode>(getInitialHoursDisplay);
  const [predictionMode, setPredictionModeState] = useState<PredictionMode>(getInitialPredictionMode);
  const [distanceUnit, setDistanceUnitState] = useState<DistanceUnit>(getInitialDistanceUnit);
  const { viewer } = useViewer();
  const hasSyncedHoursFromDb = useRef(false);
  const hasSyncedPredictionFromDb = useRef(false);
  const hasSyncedDistanceUnitFromDb = useRef(false);

  // Sync hours display from database preference when user data loads (only once per session)
  useEffect(() => {
    if (viewer?.hoursDisplayPreference && !hasSyncedHoursFromDb.current) {
      const dbPref = viewer.hoursDisplayPreference as HoursDisplayMode;
      if (dbPref === 'total' || dbPref === 'remaining') {
        setHoursDisplayState(dbPref);
        hasSyncedHoursFromDb.current = true;
      }
    }
  }, [viewer?.hoursDisplayPreference]);

  // Sync prediction mode from database preference when user data loads (only once per session)
  useEffect(() => {
    if (viewer?.predictionMode && !hasSyncedPredictionFromDb.current) {
      const dbPref = viewer.predictionMode as PredictionMode;
      if (dbPref === 'simple' || dbPref === 'predictive') {
        setPredictionModeState(dbPref);
        hasSyncedPredictionFromDb.current = true;
      }
    }
  }, [viewer?.predictionMode]);

  // Sync distance unit from database preference when user data loads (only once per session)
  useEffect(() => {
    if (viewer?.distanceUnit && !hasSyncedDistanceUnitFromDb.current) {
      const dbPref = viewer.distanceUnit as DistanceUnit;
      if (dbPref === 'mi' || dbPref === 'km') {
        setDistanceUnitState(dbPref);
        hasSyncedDistanceUnitFromDb.current = true;
      }
    }
  }, [viewer?.distanceUnit]);

  useEffect(() => {
    window.localStorage.setItem(HOURS_STORAGE_KEY, hoursDisplay);
  }, [hoursDisplay]);

  useEffect(() => {
    window.localStorage.setItem(PREDICTION_STORAGE_KEY, predictionMode);
  }, [predictionMode]);

  useEffect(() => {
    window.localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, distanceUnit);
  }, [distanceUnit]);

  const setHoursDisplay = (mode: HoursDisplayMode) => {
    setHoursDisplayState(mode);
  };

  const setPredictionMode = (mode: PredictionMode) => {
    setPredictionModeState(mode);
  };

  const setDistanceUnit = (unit: DistanceUnit) => {
    setDistanceUnitState(unit);
  };

  const value = useMemo(
    () => ({
      hoursDisplay,
      setHoursDisplay,
      predictionMode,
      setPredictionMode,
      distanceUnit,
      setDistanceUnit,
    }),
    [hoursDisplay, predictionMode, distanceUnit]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
