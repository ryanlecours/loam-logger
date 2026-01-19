import { useState, useEffect, useMemo } from 'react';
import { FaHistory, FaChevronDown, FaChevronUp, FaCheck } from 'react-icons/fa';
import { getAuthHeaders } from '@/lib/csrf';

interface ImportRidesFormProps {
  connectedProviders: Array<'strava' | 'garmin'>;
}

interface ImportStats {
  imported: number;
  skipped: number;
  isAsync: boolean;
  message?: string;
}

interface BackfillRequest {
  id: string;
  provider: 'strava' | 'garmin';
  year: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  ridesFound: number | null;
  backfilledUpTo: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

// Generate year options: YTD + current year + 5 previous years
const YEAR_OPTIONS = [
  { value: 'ytd', label: `Year to Date (${CURRENT_YEAR})` },
  ...Array.from({ length: 6 }, (_, i) => ({
    value: String(CURRENT_YEAR - i),
    label: String(CURRENT_YEAR - i),
  })),
];

const PROVIDER_LABELS: Record<string, string> = {
  strava: 'Strava',
  garmin: 'Garmin Connect',
};

export function ImportRidesForm({ connectedProviders }: ImportRidesFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'strava' | 'garmin' | ''>('');
  const [selectedYear, setSelectedYear] = useState<string>('ytd');
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Get years that are already backfilled for Garmin (YTD is always allowed - incremental)
  const garminBackfilledYears = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'garmin' &&
            req.year !== 'ytd' && // YTD is always allowed (incremental)
            req.status !== 'failed' // Failed can be retried
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  // Check if the selected year is already backfilled (Garmin only)
  const isYearAlreadyBackfilled =
    selectedProvider === 'garmin' &&
    selectedYear !== 'ytd' &&
    garminBackfilledYears.has(selectedYear);

  // Check if YTD is currently in progress (Garmin only - blocks re-triggering)
  const isYtdInProgress = useMemo(() => {
    if (selectedProvider !== 'garmin' || selectedYear !== 'ytd') return false;
    return backfillHistory.some(
      (req) => req.provider === 'garmin' && req.year === 'ytd' && req.status === 'in_progress'
    );
  }, [backfillHistory, selectedProvider, selectedYear]);

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
        const response = await fetch(`${baseUrl}/backfill/history`, {
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

  const handleImport = async () => {
    if (!selectedProvider) {
      setError('Please select a provider');
      return;
    }

    setImportState('loading');
    setError(null);

    try {
      const baseUrl = import.meta.env.VITE_API_URL;
      const url = selectedProvider === 'strava'
        ? `${baseUrl}/strava/backfill/fetch?year=${selectedYear}`
        : `${baseUrl}/garmin/backfill/fetch?year=${selectedYear}`;

      const response = await fetch(url, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle 409 Conflict (backfill already in progress)
        if (response.status === 409) {
          setError(data.message || 'A backfill for this time period is already in progress.');
          setImportState('idle');
          return;
        }
        throw new Error(data.error || 'Failed to import rides');
      }

      if (selectedProvider === 'strava') {
        setImportStats({
          imported: data.imported || 0,
          skipped: data.duplicates || 0,
          isAsync: false,
        });
      } else {
        // Garmin is async via webhooks
        setImportStats({
          imported: 0,
          skipped: 0,
          isAsync: true,
          message: data.message,
        });
      }

      setImportState('done');

      // Refresh backfill history
      try {
        const historyResponse = await fetch(`${baseUrl}/backfill/history`, {
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
              <FaCheck className="text-green-400" />
            ) : (
              <FaHistory className="text-accent" />
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
            <FaChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <FaChevronDown className="w-4 h-4 text-muted" />
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
                      onChange={(e) => setSelectedProvider(e.target.value as 'strava' | 'garmin')}
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

          {/* Year selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted">Year to import</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full input-soft"
              disabled={importState === 'loading'}
            >
              {YEAR_OPTIONS.map((option) => {
                const isBackfilled =
                  selectedProvider === 'garmin' &&
                  option.value !== 'ytd' &&
                  garminBackfilledYears.has(option.value);

                return (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {isBackfilled ? ' ✓' : ''}
                  </option>
                );
              })}
            </select>
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
                      {req.year === 'ytd' ? 'YTD' : req.year}
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
            disabled={!selectedProvider || importState === 'loading' || isYearAlreadyBackfilled || isYtdInProgress}
            className={`
              w-full py-3 px-4 rounded-lg text-sm font-medium transition-all
              ${!selectedProvider || importState === 'loading' || isYearAlreadyBackfilled || isYtdInProgress
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover'}
            `}
          >
            {importState === 'loading'
              ? 'Importing...'
              : isYtdInProgress
                ? 'Import In Progress'
                : isYearAlreadyBackfilled
                  ? 'Already Imported'
                  : 'Start Import'}
          </button>
        </div>
      )}
    </div>
  );
}
