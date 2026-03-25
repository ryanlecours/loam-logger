import { useState, useEffect, useMemo } from 'react';
import { FaCheck } from 'react-icons/fa';
import StravaGearMappingModal from './StravaGearMappingModal';
import { Modal, Button } from './ui';
import { getAuthHeaders } from '@/lib/csrf';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDuplicatesFound?: (count: number) => void;
};

type UnmappedGear = {
  gearId: string;
  rideCount: number;
};

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

// Generate year options: YTD + 5 previous years (current year is redundant with YTD)
const YEAR_OPTIONS = [
  { value: 'ytd', label: `Year to Date (${CURRENT_YEAR})` },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(CURRENT_YEAR - 1 - i),
    label: String(CURRENT_YEAR - 1 - i),
  })),
];

export default function StravaImportModal({ open, onClose, onSuccess, onDuplicatesFound }: Props) {
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [year, setYear] = useState<string>('ytd');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importStats, setImportStats] = useState<{
    imported: number;
    skipped: number;
    total: number;
  } | null>(null);
  const [unmappedGears, setUnmappedGears] = useState<UnmappedGear[]>([]);
  const [showGearMapping, setShowGearMapping] = useState(false);
  const [duplicatesFound, setDuplicatesFound] = useState(0);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Get years that are already backfilled (YTD is always allowed - incremental)
  const backfilledYears = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'strava' &&
            req.year !== 'ytd' && // YTD is always allowed (incremental)
            req.status !== 'failed' // Failed can be retried
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  // Get years that are in progress
  const inProgressYears = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'strava' &&
            (req.status === 'in_progress' || req.status === 'pending')
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  // Helper to check if a year can be selected
  const canSelectYear = (yearValue: string): boolean => {
    if (yearValue === 'ytd') {
      return !inProgressYears.has('ytd');
    }
    return !backfilledYears.has(yearValue) && !inProgressYears.has(yearValue);
  };

  // Check if selected year can be imported
  const canImport = canSelectYear(year);

  // Get status for a year
  const getYearStatus = (yearValue: string): 'backfilled' | 'in_progress' | 'available' => {
    if (inProgressYears.has(yearValue)) return 'in_progress';
    if (backfilledYears.has(yearValue)) return 'backfilled';
    return 'available';
  };

  // Fetch backfill history
  const fetchHistory = async () => {
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

  useEffect(() => {
    if (open) {
      fetchHistory();
    } else {
      // Reset state when modal closes
      setStep('period');
      setYear('ytd');
      setError(null);
      setSuccessMessage(null);
      setImportStats(null);
      setUnmappedGears([]);
      setShowGearMapping(false);
      setDuplicatesFound(0);
      setHistoryLoading(true);
    }
  }, [open]);

  const handleTriggerImport = async () => {
    if (!canImport) {
      setError('This year has already been imported');
      return;
    }

    setError(null);
    setStep('processing');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/strava/backfill/fetch?year=${year}`,
        {
          credentials: 'include',
          headers: getAuthHeaders(),
        }
      );

      if (!res.ok) {
        const errorData = await res.json();

        // Handle 409 Conflict (already backfilled)
        if (res.status === 409) {
          setSuccessMessage(errorData.message || 'This year has already been imported.');
          setStep('complete');
          await fetchHistory();
          return;
        }

        throw new Error(errorData.error || 'Failed to import activities');
      }

      const data = await res.json();
      setSuccessMessage(data.message || `Successfully imported rides from Strava.`);
      setImportStats({
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        total: data.cyclingActivities || 0,
      });
      setStep('complete');

      // Check for unmapped gears
      if (data.unmappedGears && data.unmappedGears.length > 0) {
        setUnmappedGears(data.unmappedGears);
        setShowGearMapping(true);
      }

      // Scan for duplicates after import
      try {
        const scanRes = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/scan`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (scanRes.ok) {
          const scanData = await scanRes.json();
          if (scanData.duplicatesFound > 0) {
            setDuplicatesFound(scanData.duplicatesFound);
          }
        }
      } catch (scanErr) {
        console.error('Failed to scan for duplicates:', scanErr);
      }

      // Refresh history
      await fetchHistory();

      // Call onSuccess to trigger parent refresh
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import activities');
      setStep('period');
    }
  };

  return (
    <>
      <Modal
        isOpen={open}
        onClose={onClose}
        title="Import Strava Rides"
        size="lg"
        preventClose={step === 'processing'}
      >
        {/* Step 1: Select Year */}
        {step === 'period' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted mb-4">
                Import your historical Strava cycling activities by year.
                Activities will be fetched and imported immediately.
              </p>

              <label className="block text-sm font-medium text-muted mb-2">
                Year to import
              </label>

              {historyLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted py-4">
                  <div className="w-4 h-4 border border-muted border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {YEAR_OPTIONS.map((option) => {
                    const status = getYearStatus(option.value);
                    const isBackfilled = status === 'backfilled';
                    const isInProgress = status === 'in_progress';
                    const isDisabled = !canSelectYear(option.value);
                    const isSelected = year === option.value;

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
                          name="strava-year"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => !isDisabled && setYear(option.value)}
                          className="w-4 h-4 text-accent border-gray-500 focus:ring-accent"
                        />
                        <span className={`flex-1 text-sm ${isDisabled ? 'text-muted' : 'text-primary'}`}>
                          {option.label}
                        </span>
                        {isBackfilled && (
                          <FaCheck className="w-3 h-3 text-green-400" title="Already imported" />
                        )}
                        {isInProgress && (
                          <div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" title="In progress" />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted mt-2">
                Year to Date can be run multiple times to fetch new rides since your last import.
              </p>
            </div>

            {error && (
              <div className="alert-danger-dark">
                <p className="text-sm">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleTriggerImport}
                disabled={!canImport || historyLoading}
              >
                {!canImport
                  ? inProgressYears.has(year)
                    ? 'Import In Progress'
                    : 'Already Imported'
                  : 'Import Rides'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Processing */}
        {step === 'processing' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
              <p className="text-muted">Importing activities from Strava...</p><br/>
              <p className="text-muted text-center">Depending on how many rides you have completed,<br/>this may take 1-2 minutes.</p>
            </div>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 'complete' && (
          <div className="space-y-6">
            <div className="alert-success-dark">
              <p>
                ✓ {successMessage}
              </p>
              {importStats && (
                <div className="text-sm mt-3 opacity-90 space-y-1">
                  <p className="font-medium">Import completed for {year === 'ytd' ? 'Year to Date' : year}</p>
                  <p>• Imported: {importStats.imported} rides</p>
                  <p>• Skipped (already exist): {importStats.skipped} rides</p>
                  <p>• Total cycling activities found: {importStats.total}</p>
                  {unmappedGears.length > 0 && (
                    <p className="text-warning">• {unmappedGears.length} unmapped bike(s) - visit Gear page to map</p>
                  )}
                </div>
              )}
            </div>

            {duplicatesFound > 0 && (
              <div className="alert-warning-dark">
                <p>
                  ⚠ Found {duplicatesFound} duplicate ride{duplicatesFound === 1 ? '' : 's'}
                </p>
                <p className="text-sm mt-1 opacity-90">
                  These rides exist in both Garmin and Strava. Review them to keep only one copy.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3">
              {duplicatesFound > 0 && onDuplicatesFound && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    onDuplicatesFound(duplicatesFound);
                  }}
                >
                  Review Duplicates
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {showGearMapping && unmappedGears.length > 0 && (
        <StravaGearMappingModal
          open={showGearMapping}
          onClose={() => setShowGearMapping(false)}
          onSuccess={() => {
            onSuccess();
            setUnmappedGears([]);
          }}
          unmappedGears={unmappedGears}
          trigger="import"
        />
      )}
    </>
  );
}
