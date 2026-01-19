import { useState, useEffect } from 'react';
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

  // Auto-select provider if only one is connected
  useEffect(() => {
    if (connectedProviders.length === 1 && !selectedProvider) {
      setSelectedProvider(connectedProviders[0]);
    }
  }, [connectedProviders, selectedProvider]);

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
              {YEAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Import button */}
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedProvider || importState === 'loading'}
            className={`
              w-full py-3 px-4 rounded-lg text-sm font-medium transition-all
              ${!selectedProvider || importState === 'loading'
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover'}
            `}
          >
            {importState === 'loading' ? 'Importing...' : 'Start Import'}
          </button>
        </div>
      )}
    </div>
  );
}
