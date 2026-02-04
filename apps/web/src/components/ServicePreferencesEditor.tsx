import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { FaToggleOn, FaToggleOff, FaExclamationTriangle, FaChevronDown, FaChevronRight } from 'react-icons/fa';
import {
  SERVICE_PREFERENCE_DEFAULTS_QUERY,
  USER_SERVICE_PREFERENCES_QUERY,
  UPDATE_SERVICE_PREFERENCES_MUTATION,
} from '../graphql/servicePreferences';

interface ServicePreferencesEditorProps {
  onSaved?: () => void;
  compact?: boolean;
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

interface ComponentPreference {
  componentType: string;
  displayName: string;
  defaultInterval: number;
  defaultIntervalFront: number | null;
  defaultIntervalRear: number | null;
  trackingEnabled: boolean;
  customInterval: number | null;
  hasCustomInterval: boolean;
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

export default function ServicePreferencesEditor({ onSaved, compact = false }: ServicePreferencesEditorProps) {
  const { data: defaultsData, loading: loadingDefaults } = useQuery(SERVICE_PREFERENCE_DEFAULTS_QUERY);
  const { data: userPrefsData, loading: loadingUserPrefs } = useQuery(USER_SERVICE_PREFERENCES_QUERY);
  const [updatePreferences, { loading: saving }] = useMutation(UPDATE_SERVICE_PREFERENCES_MUTATION);

  const [preferences, setPreferences] = useState<ComponentPreference[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Merge defaults with user preferences
  useEffect(() => {
    if (defaultsData?.servicePreferenceDefaults && !loadingUserPrefs) {
      const userPrefs: UserServicePreference[] = userPrefsData?.me?.servicePreferences ?? [];
      const userPrefMap = new Map(userPrefs.map((p) => [p.componentType, p]));

      const merged: ComponentPreference[] = defaultsData.servicePreferenceDefaults.map((def: ServicePreferenceDefault) => {
        const userPref = userPrefMap.get(def.componentType);
        return {
          componentType: def.componentType,
          displayName: def.displayName,
          defaultInterval: def.defaultInterval,
          defaultIntervalFront: def.defaultIntervalFront,
          defaultIntervalRear: def.defaultIntervalRear,
          trackingEnabled: userPref?.trackingEnabled ?? true,
          customInterval: userPref?.customInterval ?? null,
          hasCustomInterval: userPref?.customInterval != null,
        };
      });

      setPreferences(merged);
    }
  }, [defaultsData, userPrefsData, loadingUserPrefs]);

  const handleToggleTracking = (componentType: string) => {
    setPreferences((prev) =>
      prev.map((p) =>
        p.componentType === componentType
          ? { ...p, trackingEnabled: !p.trackingEnabled }
          : p
      )
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleIntervalChange = (componentType: string, value: string) => {
    // Handle empty input - reset to null (use default)
    if (value === '') {
      setPreferences((prev) =>
        prev.map((p) =>
          p.componentType === componentType
            ? { ...p, customInterval: null, hasCustomInterval: false }
            : p
        )
      );
      setHasChanges(true);
      setSuccess(false);
      return;
    }

    // Validate numeric input
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0 || numValue > 1000) {
      // Invalid input - don't update state, let the input show the invalid value
      // but don't propagate it. The HTML input validation will show an error.
      return;
    }

    setPreferences((prev) =>
      prev.map((p) =>
        p.componentType === componentType
          ? { ...p, customInterval: numValue, hasCustomInterval: true }
          : p
      )
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleResetToDefault = (componentType: string) => {
    setPreferences((prev) =>
      prev.map((p) =>
        p.componentType === componentType
          ? { ...p, customInterval: null, hasCustomInterval: false }
          : p
      )
    );
    setHasChanges(true);
    setSuccess(false);
  };

  const handleSave = async () => {
    setError(null);
    try {
      await updatePreferences({
        variables: {
          input: {
            preferences: preferences.map((p) => ({
              componentType: p.componentType,
              trackingEnabled: p.trackingEnabled,
              customInterval: p.hasCustomInterval ? p.customInterval : null,
            })),
          },
        },
        refetchQueries: ['UserServicePreferences', 'Bikes'],
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

  // Check if all tracking is disabled (warning condition)
  const allDisabled = preferences.length > 0 && preferences.every((p) => !p.trackingEnabled);

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {allDisabled && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400 flex items-start gap-2">
          <FaExclamationTriangle className="mt-0.5 shrink-0" />
          <span>All service tracking is disabled. Your dashboard won&apos;t show any maintenance alerts.</span>
        </div>
      )}

      <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
      {CATEGORY_ORDER.map((category) => {
        const types = CATEGORIES[category];
        const categoryPrefs = preferences.filter((p) => types.includes(p.componentType));
        if (categoryPrefs.length === 0) return null;

        const isExpanded = expandedCategories.has(category);
        const enabledCount = categoryPrefs.filter((p) => p.trackingEnabled).length;

        return (
          <div key={category} className="rounded-xl border border-app/50 overflow-hidden">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface-2 hover:bg-surface-2/80 transition"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <FaChevronDown className="text-xs text-muted" />
                ) : (
                  <FaChevronRight className="text-xs text-muted" />
                )}
                <span className="text-sm font-medium text-white">
                  {CATEGORY_LABELS[category]}
                </span>
              </div>
              <span className="text-xs text-muted">
                {enabledCount}/{categoryPrefs.length} tracked
              </span>
            </button>

            {isExpanded && (
              <div className="p-3 space-y-2 bg-surface-1/50 flex flex-col items-end">
                {categoryPrefs.map((pref) => (
                  <div
                    key={pref.componentType}
                    className={`w-full md:w-[75%] p-3 rounded-xl border transition ${
                      pref.trackingEnabled
                        ? 'border-app/70 bg-surface-2'
                        : 'border-app/30 bg-surface-2/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm text-white">{pref.displayName}</span>
                        {pref.defaultIntervalFront != null && pref.defaultIntervalRear != null && (
                          <span className="text-xs text-muted ml-2">
                            (F: {pref.defaultIntervalFront}h / R: {pref.defaultIntervalRear}h)
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleToggleTracking(pref.componentType)}
                        className="flex items-center gap-1 text-sm shrink-0"
                        title={pref.trackingEnabled ? 'Disable tracking' : 'Enable tracking'}
                      >
                        {pref.trackingEnabled ? (
                          <FaToggleOn className="text-2xl text-primary" />
                        ) : (
                          <FaToggleOff className="text-2xl text-muted" />
                        )}
                      </button>
                    </div>

                    {pref.trackingEnabled && !compact && (
                      <div className="mt-3 flex items-center gap-3 flex-wrap">
                        <label className="text-xs text-muted">Service interval:</label>
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          step="1"
                          placeholder={String(pref.defaultInterval)}
                          value={pref.customInterval ?? ''}
                          onChange={(e) => handleIntervalChange(pref.componentType, e.target.value)}
                          className="w-20 text-sm rounded-lg border border-app/50 bg-surface-1 px-2 py-1 text-white placeholder-muted/60 focus:border-primary focus:outline-none"
                        />
                        <span className="text-xs text-muted">hours</span>
                        {pref.hasCustomInterval && (
                          <button
                            onClick={() => handleResetToDefault(pref.componentType)}
                            className="text-xs text-primary hover:underline"
                          >
                            Reset to default
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-app/50">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
        {hasChanges && <span className="text-xs text-amber-400">Unsaved changes</span>}
        {success && <span className="text-xs text-green-400">Saved!</span>}
      </div>
    </div>
  );
}
