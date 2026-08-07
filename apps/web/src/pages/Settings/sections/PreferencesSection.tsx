import { useCallback, useState } from 'react';
import { useMutation } from '@apollo/client';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { usePreferences } from '../../../hooks/usePreferences';
import { useUserTier } from '../../../hooks/useUserTier';
import { UPDATE_USER_PREFERENCES_MUTATION } from '../../../graphql/userPreferences';
import { ProChip } from '../../../components/UpgradePrompt';
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

  // AI is opt-in and off by default at every tier (owner decision recorded
  // in PRODUCT.md). Reads straight off the cached user and saves on change;
  // the mutation returns aiFeaturesEnabled so the normalized cache updates
  // without a refetch, same as the analytics opt-out toggle.
  const aiEnabled = Boolean(user?.aiFeaturesEnabled);
  const [aiSaving, setAiSaving] = useState(false);

  const handleAiToggle = async () => {
    setAiSaving(true);
    try {
      await updateUserPreferences({ variables: { input: { aiFeaturesEnabled: !aiEnabled } } });
      toast.success('Saved', {
        id: 'settings-preference-ai-summary',
        description: 'AI maintenance summary',
      });
    } catch {
      toast.error('Could not save', {
        id: 'settings-preference-ai-summary',
        description: 'AI maintenance summary',
      });
    } finally {
      setAiSaving(false);
    }
  };

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
                    navigate('/pricing?source=settings-predictive-mode');
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
            {!isPro && <ProChip className="ml-2" source="settings-predictive-mode" />}
          </label>
        </div>
        <p className="text-xs text-muted">
          {isPro
            ? 'Predictive mode adjusts service intervals based on your riding intensity and terrain. Estimates sharpen as you log more rides.'
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

      <div className="panel-spaced">
        <div>
          <p className="label-section">AI</p>
          <h2 className="title-section">AI maintenance summary</h2>
        </div>
        <p className="text-sm text-muted">
          A short machine-generated read of a bike's wear picture on your
          dashboard: what to wrench on first and what can wait. Strictly
          optional and off by default; predictions and service history never
          depend on it.
        </p>
        {isPro ? (
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={handleAiToggle}
              disabled={aiSaving}
              className="mt-1 w-5 h-5 rounded border-app bg-surface accent-accent flex-shrink-0 disabled:opacity-50"
            />
            <span className="text-sm leading-relaxed text-primary">
              Show the AI summary on my dashboard.
            </span>
          </label>
        ) : (
          // Same idiom as the predictive-mode card above: inert control,
          // quiet Pro chip, the whole row routes to pricing.
          <label
            className="flex items-start gap-3 cursor-not-allowed select-none opacity-60"
            onClick={(e) => {
              e.preventDefault();
              navigate('/pricing?source=settings-ai-summary');
            }}
          >
            <input
              type="checkbox"
              checked={false}
              readOnly
              disabled
              className="mt-1 w-5 h-5 rounded border-app bg-surface flex-shrink-0"
            />
            <span className="text-sm leading-relaxed text-primary">
              Show the AI summary on my dashboard.
              <ProChip className="ml-2" source="settings-ai-summary" />
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
