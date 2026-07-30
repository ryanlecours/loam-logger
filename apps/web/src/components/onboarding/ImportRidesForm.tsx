import { useState, useEffect, useMemo } from 'react';
import { History, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { getAuthHeaders } from '@/lib/csrf';
import { useUserTier } from '@/hooks/useUserTier';
import { UpsellCard } from '@/components/UpgradePrompt';

interface ImportRidesFormProps {
  connectedProviders: Array<'strava' | 'garmin' | 'suunto'>;
}

interface ImportStats {
  imported: number;
  skipped: number;
  isAsync: boolean;
  message?: string;
}

interface BackfillRequest {
  id: string;
  provider: 'strava' | 'garmin' | 'suunto';
  year: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  ridesFound: number | null;
  backfilledUpTo: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

// Strava allows full historical backfills
const STRAVA_YEAR_OPTIONS = [
  { value: 'ytd', label: `Year to Date (${CURRENT_YEAR})` },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(CURRENT_YEAR - 1 - i),
    label: String(CURRENT_YEAR - 1 - i),
  })),
];

// Garmin imports are rolling windows, shortest first. They nest (7 days is
// inside 30), so this is a single choice rather than a multi-select.
const GARMIN_PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '14d', label: 'Last 14 Days' },
  { value: '30d', label: 'Last 30 Days' },
];

const DEFAULT_GARMIN_PERIOD = '30d';

const garminPeriodLabel = (value: string) =>
  GARMIN_PERIOD_OPTIONS.find((option) => option.value === value)?.label ?? value;

// Past requests are keyed the same way, so a chip may be a window ('7d'), a
// year, or 'ytd' left over from an earlier import.
const historyPeriodLabel = (value: string) => {
  if (value === 'ytd') return 'YTD';
  const window = GARMIN_PERIOD_OPTIONS.find((option) => option.value === value);
  return window ? window.label.replace('Last ', '') : value;
};

// Suunto allows historical backfills back to 2015 (same as Strava)
const SUUNTO_YEAR_OPTIONS = [
  { value: 'ytd', label: `Year to Date (${CURRENT_YEAR})` },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(CURRENT_YEAR - 1 - i),
    label: String(CURRENT_YEAR - 1 - i),
  })),
];

const PROVIDER_LABELS: Record<string, string> = {
  strava: 'Strava',
  garmin: 'Garmin Connect',
  suunto: 'Suunto',
};

export function ImportRidesForm({ connectedProviders }: ImportRidesFormProps) {
  const { isPro } = useUserTier();
  const [expanded, setExpanded] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'strava' | 'garmin' | 'suunto' | ''>('');
  const [selectedYear, setSelectedYear] = useState<string>('ytd'); // For Strava/Suunto
  const [selectedGarminPeriod, setSelectedGarminPeriod] = useState<string>(DEFAULT_GARMIN_PERIOD);
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Garmin periods with a sync already queued or running
  const garminInProgressPeriods = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'garmin' &&
            (req.status === 'in_progress' || req.status === 'pending')
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  // A window already syncing can't be re-triggered until it finishes
  const isGarminPeriodInProgress =
    selectedProvider === 'garmin' && garminInProgressPeriods.has(selectedGarminPeriod);

  // Auto-select provider if only one is connected
  useEffect(() => {
    if (connectedProviders.length === 1 && !selectedProvider) {
      setSelectedProvider(connectedProviders[0]);
    }
  }, [connectedProviders, selectedProvider]);

  // Fetch backfill history on mount
  useEffect(() => {
    const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
        const baseUrl = import.meta.env.VITE_API_URL;
        const response = await fetch(`${baseUrl}/api/backfill/history`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          setBackfillHistory(data.requests || []);
        }
      } catch {
        // Silently fail - history is supplementary
      } finally {
        setHistoryLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const refreshBackfillHistory = async () => {
    try {
      const baseUrl = import.meta.env.VITE_API_URL;
      const historyResponse = await fetch(`${baseUrl}/api/backfill/history`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (historyResponse.ok) {
        const historyData = await historyResponse.json();
        setBackfillHistory(historyData.requests || []);
      }
    } catch {
      // Ignore history refresh errors
    }
  };

  const handleImport = async () => {
    if (!selectedProvider) {
      setError('Please select a provider');
      return;
    }

    setImportState('loading');
    setError(null);

    try {
      const baseUrl = import.meta.env.VITE_API_URL;

      if (selectedProvider === 'garmin') {
        // Garmin queues in the background; the API reads each `years` entry as
        // a period key, which for us is always one rolling window.
        if (!selectedGarminPeriod) {
          setError('Please select a time period');
          setImportState('idle');
          return;
        }

        const response = await fetch(`${baseUrl}/api/garmin/backfill/batch`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ years: [selectedGarminPeriod] }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 409) {
            setError(data.message || 'That time period is already syncing.');
            setImportState('idle');
            return;
          }
          throw new Error(data.message || data.error || 'Failed to queue backfill');
        }

        setImportStats({
          imported: 0,
          skipped: data.skipped?.length || 0,
          isAsync: true,
          message: data.message,
        });

        setImportState('done');
        await refreshBackfillHistory();
      } else {
        // Strava and Suunto both use a synchronous single-year endpoint
        const response = await fetch(
          `${baseUrl}/api/${selectedProvider}/backfill/fetch?year=${selectedYear}`,
          {
            credentials: 'include',
            headers: getAuthHeaders(),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 409) {
            setError(data.message || 'A backfill for this time period is already in progress.');
            setImportState('idle');
            return;
          }
          throw new Error(data.error || 'Failed to import rides');
        }

        setImportStats({
          imported: data.imported || 0,
          skipped: data.skipped ?? data.duplicates ?? 0,
          isAsync: false,
        });

        setImportState('done');
        await refreshBackfillHistory();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setImportState('idle');
    }
  };

  // If no providers connected, don't render anything
  if (connectedProviders.length === 0) {
    return null;
  }

  return (
    <div className="w-full rounded-lg border-2 border-app overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        disabled={importState === 'loading'}
        className={`
          w-full p-4 flex items-center justify-between transition-colors
          ${importState === 'done'
            ? 'bg-green-500/10'
            : 'bg-surface hover:bg-surface-hover'}
          ${importState === 'loading' ? 'cursor-wait' : ''}
        `}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
            {importState === 'loading' ? (
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            ) : importState === 'done' ? (
              <Check className="text-green-400" />
            ) : (
              <History className="text-accent" />
            )}
          </div>
          <div className="text-left">
            <span className="font-medium text-primary">Import past rides</span>
            {importState === 'done' && importStats && (
              <div className="text-sm text-green-400">
                {importStats.isAsync
                  ? 'Import started - rides will sync shortly'
                  : `${importStats.imported} rides imported${importStats.skipped > 0 ? `, ${importStats.skipped} already existed` : ''}`}
              </div>
            )}
            {importState === 'idle' && !expanded && (
              <div className="text-sm text-muted">Backfill component wear from your ride history</div>
            )}
          </div>
        </div>
        {importState !== 'loading' && (
          expanded ? (
            <ChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted" />
          )
        )}
      </button>

      {/* Expanded content */}
      {expanded && importState !== 'done' && (
        <div className="p-4 border-t border-app bg-surface-2 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-danger">
              {error}
            </div>
          )}

          {/* Provider selector - only show if multiple providers */}
          {connectedProviders.length > 1 && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted">Import from</label>
              <div className="space-y-2">
                {connectedProviders.map((provider) => (
                  <label
                    key={provider}
                    className={`
                      flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                      ${selectedProvider === provider
                        ? 'border-accent bg-accent/10'
                        : 'border-app hover:border-accent/50'}
                    `}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={provider}
                      checked={selectedProvider === provider}
                      onChange={(e) => setSelectedProvider(e.target.value as 'strava' | 'garmin' | 'suunto')}
                      className="w-4 h-4 text-accent border-gray-500 focus:ring-accent"
                    />
                    <span className="text-primary">{PROVIDER_LABELS[provider]}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Single provider display */}
          {connectedProviders.length === 1 && (
            <div className="text-sm text-muted">
              Importing from <span className="text-primary font-medium">{PROVIDER_LABELS[connectedProviders[0]]}</span>
            </div>
          )}

          {/* Year selector - Garmin uses multi-select checkboxes, Strava uses dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted">
              {selectedProvider === 'garmin' ? 'Import period' : 'Year to import'}
            </label>

            {selectedProvider === 'garmin' ? (
              // Garmin: one rolling window, since the windows nest
              <div className="space-y-3">
                {GARMIN_PERIOD_OPTIONS.map((option) => {
                  const isInProgress = garminInProgressPeriods.has(option.value);
                  const isDisabled = isInProgress || importState === 'loading';
                  const isSelected = selectedGarminPeriod === option.value;

                  return (
                    <label
                      key={option.value}
                      className={`
                        flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors
                        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                        ${isSelected && !isDisabled
                          ? 'border-accent bg-accent/10'
                          : 'border-app hover:border-accent/50'}
                      `}
                    >
                      <input
                        type="radio"
                        name="garmin-import-period"
                        value={option.value}
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && setSelectedGarminPeriod(option.value)}
                        className="w-4 h-4 text-accent border-gray-500 focus:ring-accent"
                      />
                      <span className={`flex-1 text-sm ${isDisabled ? 'text-muted' : 'text-primary'}`}>
                        {option.label}
                      </span>
                      {isInProgress && (
                        <div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" title="In progress" />
                      )}
                    </label>
                  );
                })}
                <p className="text-xs text-muted">
                  Garmin sends the rides in the window you pick. New rides keep syncing automatically, and you
                  can run this again anytime.
                </p>
              </div>
            ) : (
              // Strava and Suunto: full year selection. Past seasons are a
              // Pro feature — free accounts import the current year only.
              <>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full input-soft"
                  disabled={importState === 'loading'}
                >
                  {(selectedProvider === 'suunto' ? SUUNTO_YEAR_OPTIONS : STRAVA_YEAR_OPTIONS).map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={!isPro && option.value !== 'ytd'}
                    >
                      {option.label}
                      {!isPro && option.value !== 'ytd' ? ' — Pro' : ''}
                    </option>
                  ))}
                </select>
                {!isPro && <UpsellCard feature="importDepth" className="mt-2" />}
              </>
            )}
          </div>

          {/* Backfill history for selected provider */}
          {selectedProvider && (historyLoading || backfillHistory.filter(r => r.provider === selectedProvider).length > 0) && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-muted">Previously requested</label>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <div className="w-3 h-3 border border-muted border-t-transparent rounded-full animate-spin" />
                  Loading history...
                </div>
              ) : (
              <div className="flex flex-wrap gap-2">
                {backfillHistory
                  .filter((req) => req.provider === selectedProvider)
                  .map((req) => (
                    <div
                      key={req.id}
                      className={`
                        px-2.5 py-1 rounded-full text-xs font-medium
                        ${req.status === 'completed'
                          ? 'bg-green-500/20 text-green-400'
                          : req.status === 'in_progress'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : req.status === 'failed'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-gray-500/20 text-gray-400'}
                      `}
                      title={`${req.status}${req.ridesFound ? ` - ${req.ridesFound} rides` : ''}`}
                    >
                      {historyPeriodLabel(req.year)}
                      {req.status === 'completed' && req.ridesFound !== null && (
                        <span className="ml-1 opacity-75">({req.ridesFound})</span>
                      )}
                      {req.status === 'in_progress' && (
                        <span className="ml-1 opacity-75">...</span>
                      )}
                    </div>
                  ))}
              </div>
              )}
            </div>
          )}

          {/* Bike assignment note */}
          {selectedProvider && (
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-muted">
              {selectedProvider === 'garmin' ? (
                <>
                  <span className="font-medium text-primary">Note:</span> If you rode multiple bikes, you'll need to assign the correct bike to each ride after import. Unassigned rides won't contribute to component wear tracking.
                </>
              ) : selectedProvider === 'suunto' ? (
                <>
                  <span className="font-medium text-primary">Note:</span> Suunto doesn't provide gear mapping, so rides will be auto-assigned to your bike if you only have one. Otherwise you'll need to assign each ride after import.
                </>
              ) : (
                <>
                  <span className="font-medium text-primary">Note:</span> You'll be prompted to map your Strava gear to your bikes. Unmapped gear won't contribute to component wear tracking.
                </>
              )}
            </div>
          )}

          {/* Import button */}
          <button
            type="button"
            onClick={handleImport}
            disabled={
              !selectedProvider ||
              importState === 'loading' ||
              (selectedProvider === 'garmin' && (!selectedGarminPeriod || isGarminPeriodInProgress))
            }
            className={`
              w-full py-3 px-4 rounded-lg text-sm font-medium transition-all
              ${!selectedProvider ||
                importState === 'loading' ||
                (selectedProvider === 'garmin' && (!selectedGarminPeriod || isGarminPeriodInProgress))
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover'}
            `}
          >
            {importState === 'loading'
              ? 'Importing...'
              : selectedProvider === 'garmin'
                ? isGarminPeriodInProgress
                  ? 'Import In Progress'
                  : `Import ${garminPeriodLabel(selectedGarminPeriod)}`
                : 'Start Import'}
          </button>
        </div>
      )}
    </div>
  );
}
