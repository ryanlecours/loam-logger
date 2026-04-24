import { useCallback } from 'react';
import { useMutation } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { usePreferences } from '../../../hooks/usePreferences';
import { useUserTier } from '../../../hooks/useUserTier';
import { UPDATE_USER_PREFERENCES_MUTATION } from '../../../graphql/userPreferences';
import { ProBadge } from '../../../components/ui/ProBadge';
import SettingsSectionHeader from '../SettingsSectionHeader';
import { useAutoSavePreference } from '../useAutoSavePreference';

type HoursDisplay = 'total' | 'remaining';
type PredictionMode = 'simple' | 'predictive';
type DistanceUnit = 'mi' | 'km';

export default function PreferencesSection() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { isPro } = useUserTier();
  const { hoursDisplay, setHoursDisplay, predictionMode, setPredictionMode, distanceUnit, setDistanceUnit } =
    usePreferences();

  const [updateUserPreferences] = useMutation(UPDATE_USER_PREFERENCES_MUTATION);

  const mutateHours = useCallback(
    (v: HoursDisplay) =>
      updateUserPreferences({ variables: { input: { hoursDisplayPreference: v } } }),
    [updateUserPreferences],
  );
  const mutatePrediction = useCallback(
    (v: PredictionMode) =>
      updateUserPreferences({ variables: { input: { predictionMode: v } } }),
    [updateUserPreferences],
  );
  const mutateDistance = useCallback(
    (v: DistanceUnit) => updateUserPreferences({ variables: { input: { distanceUnit: v } } }),
    [updateUserPreferences],
  );

  useAutoSavePreference<HoursDisplay>({
    value: hoursDisplay,
    setValue: setHoursDisplay,
    dbValue: user?.hoursDisplayPreference as HoursDisplay | null | undefined,
    mutate: mutateHours,
    label: 'Component hours display',
  });

  useAutoSavePreference<PredictionMode>({
    value: predictionMode,
    setValue: setPredictionMode,
    dbValue: user?.predictionMode as PredictionMode | null | undefined,
    mutate: mutatePrediction,
    label: 'Prediction algorithm',
  });

  useAutoSavePreference<DistanceUnit>({
    value: distanceUnit,
    setValue: setDistanceUnit,
    dbValue: user?.distanceUnit as DistanceUnit | null | undefined,
    mutate: mutateDistance,
    label: 'Distance unit',
  });

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Preferences"
        title="Display & Predictions"
        description="Fine-tune how Loam Logger displays ride data. Changes save automatically."
      />

      <div className="panel-spaced">
        <div>
          <p className="label-section">Algorithm</p>
          <h2 className="title-section">Prediction</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              predictionMode === 'simple'
                ? 'border-primary/60 bg-surface-accent/60'
                : 'border-app/60 bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="prediction-mode"
              value="simple"
              className="mr-2"
              checked={predictionMode === 'simple'}
              onChange={() => setPredictionMode('simple')}
            />
            Simple (hours-based)
          </label>
          <label
            className={`rounded-2xl border px-4 py-3 transition ${
              isPro
                ? `cursor-pointer ${
                    predictionMode === 'predictive'
                      ? 'border-primary/60 bg-surface-accent/60'
                      : 'border-app/60 bg-surface-2'
                  }`
                : 'cursor-not-allowed border-app/40 bg-surface-2 opacity-60'
            }`}
            onClick={
              !isPro
                ? (e) => {
                    e.preventDefault();
                    navigate('/pricing');
                  }
                : undefined
            }
          >
            <input
              type="radio"
              name="prediction-mode"
              value="predictive"
              className="mr-2"
              checked={predictionMode === 'predictive'}
              onChange={() => isPro && setPredictionMode('predictive')}
              disabled={!isPro}
            />
            Predictive (ride-adjusted)
            {!isPro && <ProBadge className="ml-2 inline-flex items-center gap-1" />}
          </label>
        </div>
        <p className="text-xs text-muted">
          {isPro
            ? 'Predictive mode adjusts service intervals based on your riding intensity and terrain. Still in beta.'
            : 'Upgrade to Pro to unlock predictive wear analysis based on your riding intensity and terrain.'}
        </p>
      </div>

      <div className="panel-spaced">
        <div>
          <p className="label-section">Display</p>
          <h2 className="title-section">Component hours</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === 'total'
                ? 'border-primary/60 bg-surface-accent/60'
                : 'border-app/60 bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="total"
              className="mr-2"
              checked={hoursDisplay === 'total'}
              onChange={() => setHoursDisplay('total')}
            />
            Show cumulative hours (e.g. 780h / 800h)
          </label>
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === 'remaining'
                ? 'border-primary/60 bg-surface-accent/60'
                : 'border-app/60 bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="remaining"
              className="mr-2"
              checked={hoursDisplay === 'remaining'}
              onChange={() => setHoursDisplay('remaining')}
            />
            Show time until next service (e.g. 0h / 50h)
          </label>
        </div>
        <p className="text-xs text-muted">
          Total hours are always stored. This preference only affects how we display service intervals.
        </p>
      </div>

      <div className="panel-spaced">
        <div>
          <p className="label-section">Units</p>
          <h2 className="title-section">Distance</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              distanceUnit === 'mi'
                ? 'border-primary/60 bg-surface-accent/60'
                : 'border-app/60 bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="distance-unit"
              value="mi"
              className="mr-2"
              checked={distanceUnit === 'mi'}
              onChange={() => setDistanceUnit('mi')}
            />
            Miles (mi)
          </label>
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              distanceUnit === 'km'
                ? 'border-primary/60 bg-surface-accent/60'
                : 'border-app/60 bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name="distance-unit"
              value="km"
              className="mr-2"
              checked={distanceUnit === 'km'}
              onChange={() => setDistanceUnit('km')}
            />
            Kilometers (km)
          </label>
        </div>
        <p className="text-xs text-muted">
          Distances are always stored in miles. This preference only affects how they are displayed and entered.
        </p>
      </div>
    </div>
  );
}
