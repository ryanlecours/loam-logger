import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { FaToggleOn, FaToggleOff, FaUndo } from 'react-icons/fa';
import {
  SERVICE_PREFERENCE_DEFAULTS_QUERY,
  USER_SERVICE_PREFERENCES_QUERY,
  UPDATE_BIKE_SERVICE_PREFERENCES_MUTATION,
} from '../graphql/servicePreferences';
import { GEAR_QUERY } from '../graphql/gear';

interface BikeServicePreferencesEditorProps {
  bikeId: string;
  bikeServicePreferences: BikeServicePreference[];
  onSaved?: () => void;
}

interface ServicePreferenceDefault {
  componentType: string;
  displayName: string;
  defaultInterval: number;
  defaultIntervalFront: number | null;
  defaultIntervalRear: number | null;
}

interface UserServicePreference {
  id: string;
  componentType: string;
  trackingEnabled: boolean;
  customInterval: number | null;
}

interface BikeServicePreference {
  id: string;
  componentType: string;
  trackingEnabled: boolean;
  customInterval: number | null;
}

interface ComponentPreference {
  componentType: string;
  displayName: string;
  defaultInterval: number;
  defaultIntervalFront: number | null;
  defaultIntervalRear: number | null;
  // Global (user-level) preference
  globalTrackingEnabled: boolean;
  globalCustomInterval: number | null;
  // Bike-specific override
  hasOverride: boolean;
  overrideTrackingEnabled: boolean;
  overrideCustomInterval: number | null;
  // Effective values (what will actually be used)
  effectiveTrackingEnabled: boolean;
  effectiveCustomInterval: number | null;
}

const CATEGORY_ORDER = ['suspension', 'braking', 'drivetrain', 'wheels', 'bearings'] as const;

const CATEGORIES: Record<string, string[]> = {
  suspension: ['FORK', 'SHOCK'],
  braking: ['BRAKES', 'BRAKE_PAD', 'BRAKE_ROTOR'],
  drivetrain: ['CHAIN', 'CASSETTE', 'DRIVETRAIN', 'REAR_DERAILLEUR'],
  wheels: ['TIRES', 'WHEEL_HUBS', 'RIMS'],
  bearings: ['PIVOT_BEARINGS', 'HEADSET', 'BOTTOM_BRACKET', 'DROPPER'],
};

const CATEGORY_LABELS: Record<string, string> = {
  suspension: 'Suspension',
  braking: 'Brakes',
  drivetrain: 'Drivetrain',
  wheels: 'Wheels & Tires',
  bearings: 'Bearings & Dropper',
};

export default function BikeServicePreferencesEditor({
  bikeId,
  bikeServicePreferences,
  onSaved,
}: BikeServicePreferencesEditorProps) {
  const { data: defaultsData, loading: loadingDefaults } = useQuery(SERVICE_PREFERENCE_DEFAULTS_QUERY);
  const { data: userPrefsData, loading: loadingUserPrefs } = useQuery(USER_SERVICE_PREFERENCES_QUERY);
  const [updatePreferences, { loading: saving }] = useMutation(UPDATE_BIKE_SERVICE_PREFERENCES_MUTATION);

  const [preferences, setPreferences] = useState<ComponentPreference[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Merge defaults, user preferences, and bike preferences
  useEffect(() => {
    if (defaultsData?.servicePreferenceDefaults && !loadingUserPrefs) {
      const userPrefs: UserServicePreference[] = userPrefsData?.me?.servicePreferences ?? [];
      const userPrefMap = new Map(userPrefs.map((p) => [p.componentType, p]));
      const bikePrefMap = new Map(bikeServicePreferences.map((p) => [p.componentType, p]));

      const merged: ComponentPreference[] = defaultsData.servicePreferenceDefaults.map(
        (def: ServicePreferenceDefault) => {
          const userPref = userPrefMap.get(def.componentType);
          const bikePref = bikePrefMap.get(def.componentType);

          // Global defaults
          const globalTrackingEnabled = userPref?.trackingEnabled ?? true;
          const globalCustomInterval = userPref?.customInterval ?? null;

          // Bike override (if exists)
          const hasOverride = !!bikePref;
          const overrideTrackingEnabled = bikePref?.trackingEnabled ?? globalTrackingEnabled;
          const overrideCustomInterval = bikePref?.customInterval ?? null;

          // Effective values (bike override > global)
          const effectiveTrackingEnabled = hasOverride ? overrideTrackingEnabled : globalTrackingEnabled;
          const effectiveCustomInterval = hasOverride
            ? overrideCustomInterval
            : globalCustomInterval;

          return {
            componentType: def.componentType,
            displayName: def.displayName,
            defaultInterval: def.defaultInterval,
            defaultIntervalFront: def.defaultIntervalFront,
            defaultIntervalRear: def.defaultIntervalRear,
            globalTrackingEnabled,
            globalCustomInterval,
            hasOverride,
            overrideTrackingEnabled,
            overrideCustomInterval,
            effectiveTrackingEnabled,
            effectiveCustomInterval,
          };
        }
      );

      setPreferences(merged);
    }
  }, [defaultsData, userPrefsData, loadingUserPrefs, bikeServicePreferences]);

  const handleToggleOverride = (componentType: string) => {
    setPreferences((prev) =>
      prev.map((p) => {
        if (p.componentType !== componentType) return p;

        if (p.hasOverride) {
          // Remove override - revert to global
          return {
            ...p,
            hasOverride: false,
            effectiveTrackingEnabled: p.globalTrackingEnabled,
            effectiveCustomInterval: p.globalCustomInterval,
          };
        } else {
          // Create override with current global values
          return {
            ...p,
            hasOverride: true,
            overrideTrackingEnabled: p.globalTrackingEnabled,
            overrideCustomInterval: p.globalCustomInterval,
            effectiveTrackingEnabled: p.globalTrackingEnabled,
            effectiveCustomInterval: p.globalCustomInterval,
          };
        }
      })
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleToggleTracking = (componentType: string) => {
    setPreferences((prev) =>
      prev.map((p) => {
        if (p.componentType !== componentType || !p.hasOverride) return p;
        const newTracking = !p.overrideTrackingEnabled;
        return {
          ...p,
          overrideTrackingEnabled: newTracking,
          effectiveTrackingEnabled: newTracking,
        };
      })
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleIntervalChange = (componentType: string, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setPreferences((prev) =>
      prev.map((p) => {
        if (p.componentType !== componentType || !p.hasOverride) return p;
        return {
          ...p,
          overrideCustomInterval: numValue,
          effectiveCustomInterval: numValue,
        };
      })
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleResetAllToGlobal = () => {
    setPreferences((prev) =>
      prev.map((p) => ({
        ...p,
        hasOverride: false,
        effectiveTrackingEnabled: p.globalTrackingEnabled,
        effectiveCustomInterval: p.globalCustomInterval,
      }))
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleSave = async () => {
    setError(null);
    try {
      // Only send preferences that have overrides
      const overrides = preferences
        .filter((p) => p.hasOverride)
        .map((p) => ({
          componentType: p.componentType,
          trackingEnabled: p.overrideTrackingEnabled,
          customInterval: p.overrideCustomInterval,
        }));

      await updatePreferences({
        variables: {
          input: {
            bikeId,
            preferences: overrides,
          },
        },
        refetchQueries: [{ query: GEAR_QUERY }],
      });

      setHasChanges(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      onSaved?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to save preferences: ${message}`);
    }
  };

  if (loadingDefaults || loadingUserPrefs) {
    return <div className="text-muted text-sm">Loading preferences...</div>;
  }

  const hasAnyOverrides = preferences.some((p) => p.hasOverride);

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      <p className="text-sm text-muted">
        Override global settings for this bike. Components without overrides use your global defaults.
      </p>

      {hasAnyOverrides && (
        <button
          onClick={handleResetAllToGlobal}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <FaUndo className="text-xs" />
          Reset all to global defaults
        </button>
      )}

      {CATEGORY_ORDER.map((category) => {
        const types = CATEGORIES[category];
        const categoryPrefs = preferences.filter((p) => types.includes(p.componentType));
        if (categoryPrefs.length === 0) return null;

        return (
          <div key={category} className="space-y-2">
            <h4 className="text-xs font-medium text-muted uppercase tracking-wider">
              {CATEGORY_LABELS[category]}
            </h4>
            <div className="space-y-2">
              {categoryPrefs.map((pref) => (
                <div
                  key={pref.componentType}
                  className={`p-3 rounded-xl border transition ${
                    pref.effectiveTrackingEnabled
                      ? 'border-app/70 bg-surface-2'
                      : 'border-app/30 bg-surface-2/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white">{pref.displayName}</span>
                        {pref.hasOverride ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                            Overridden
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted font-medium">
                            Global
                          </span>
                        )}
                      </div>
                      {!pref.hasOverride && (
                        <div className="text-xs text-muted mt-0.5">
                          {pref.globalTrackingEnabled ? 'Tracking enabled' : 'Tracking disabled'}
                          {pref.globalCustomInterval && ` (${pref.globalCustomInterval}h interval)`}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleToggleOverride(pref.componentType)}
                      className="text-xs text-primary hover:underline shrink-0"
                    >
                      {pref.hasOverride ? 'Use global' : 'Override'}
                    </button>
                  </div>

                  {pref.hasOverride && (
                    <div className="mt-3 pt-3 border-t border-app/30">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleToggleTracking(pref.componentType)}
                            className="flex items-center gap-1 text-sm"
                            title={pref.overrideTrackingEnabled ? 'Disable tracking' : 'Enable tracking'}
                          >
                            {pref.overrideTrackingEnabled ? (
                              <FaToggleOn className="text-2xl text-primary" />
                            ) : (
                              <FaToggleOff className="text-2xl text-muted" />
                            )}
                          </button>
                          <span className="text-xs text-muted">
                            {pref.overrideTrackingEnabled ? 'Tracking enabled' : 'Tracking disabled'}
                          </span>
                        </div>

                        {pref.overrideTrackingEnabled && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-muted">Interval:</label>
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              placeholder={String(
                                pref.globalCustomInterval ?? pref.defaultInterval
                              )}
                              value={pref.overrideCustomInterval ?? ''}
                              onChange={(e) =>
                                handleIntervalChange(pref.componentType, e.target.value)
                              }
                              className="w-16 text-sm rounded-lg border border-app/50 bg-surface-1 px-2 py-1 text-white placeholder-muted/60 focus:border-primary focus:outline-none"
                            />
                            <span className="text-xs text-muted">hrs</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3 pt-4 border-t border-app/50">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {hasChanges && <span className="text-xs text-amber-400">Unsaved changes</span>}
        {success && <span className="text-xs text-green-400">Saved!</span>}
      </div>
    </div>
  );
}
