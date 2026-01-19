import { useState, useEffect, useMemo } from 'react';
import { FaCheck } from 'react-icons/fa';
import { Modal, Button } from './ui';
import { getAuthHeaders } from '@/lib/csrf';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDuplicatesFound?: (count: number) => void;
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

export default function GarminImportModal({ open, onClose, onSuccess, onDuplicatesFound }: Props) {
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set(['ytd']));
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [duplicatesFound, setDuplicatesFound] = useState(0);

  // Get years that are already backfilled (YTD is always allowed - incremental)
  const backfilledYears = useMemo(() => {
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

  // Get years that are in progress
  const inProgressYears = useMemo(() => {
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

  // Helper to check if a year can be selected
  const canSelectYear = (year: string): boolean => {
    if (year === 'ytd') {
      return !inProgressYears.has('ytd');
    }
    return !backfilledYears.has(year) && !inProgressYears.has(year);
  };

  // Toggle year selection
  const toggleYearSelection = (year: string) => {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  // Get count of selectable years for button text
  const selectableYearsCount = selectedYears.size;

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
      setSelectedYears(new Set(['ytd']));
      setError(null);
      setSuccessMessage(null);
      setDuplicatesFound(0);
      setHistoryLoading(true);
    }
  }, [open]);

  const handleTriggerBackfill = async () => {
    const yearsArray = Array.from(selectedYears);
    if (yearsArray.length === 0) {
      setError('Please select at least one year');
      return;
    }

    setError(null);
    setStep('processing');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/garmin/backfill/batch`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ years: yearsArray }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        // Handle 409 Conflict (all years already backfilled)
        if (res.status === 409) {
          setSuccessMessage(data.message || 'Selected years are already imported or in progress.');
          setStep('complete');
          await fetchHistory();
          return;
        }

        throw new Error(data.message || data.error || 'Failed to trigger backfill');
      }

      const queuedCount = data.queued?.length || 0;
      const skippedCount = data.skipped?.length || 0;
      setSuccessMessage(
        data.message ||
        `Queued ${queuedCount} year${queuedCount !== 1 ? 's' : ''} for import.${skippedCount > 0 ? ` ${skippedCount} already imported.` : ''}`
      );
      setStep('complete');

      // Scan for existing duplicates
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

      // Refresh history to show new pending items
      await fetchHistory();

      // Call onSuccess to show toast in parent
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backfill');
      setStep('period');
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Import Garmin Rides"
      size="lg"
      preventClose={step === 'processing'}
    >
      {/* Step 1: Select Years */}
      {step === 'period' && (
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted mb-4">
              Select years to import your historical Garmin cycling activities.
              Garmin will send your rides via webhooks, and they'll appear automatically.
            </p>

            <label className="block text-sm font-medium text-muted mb-2">
              Years to import
            </label>

            {historyLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted py-4">
                <div className="w-4 h-4 border border-muted border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {YEAR_OPTIONS.map((option) => {
                  const isBackfilled = backfilledYears.has(option.value);
                  const isInProgress = inProgressYears.has(option.value);
                  const isDisabled = !canSelectYear(option.value);
                  const isSelected = selectedYears.has(option.value);

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
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && toggleYearSelection(option.value)}
                        className="w-4 h-4 text-accent border-gray-500 focus:ring-accent rounded"
                      />
                      <span className={`flex-1 text-sm ${isDisabled ? 'text-muted' : 'text-primary'}`}>
                        {option.label}
                      </span>
                      {isBackfilled && (
                        <FaCheck className="w-3 h-3 text-green-400" title="Already imported" />
                      )}
                      {isInProgress && !isBackfilled && (
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
              onClick={handleTriggerBackfill}
              disabled={selectableYearsCount === 0 || historyLoading}
            >
              {selectableYearsCount === 0
                ? 'Select years to import'
                : `Import ${selectableYearsCount} ${selectableYearsCount === 1 ? 'Year' : 'Years'}`}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Processing */}
      {step === 'processing' && (
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted">Queuing backfill request...</p>
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
            <p className="text-sm mt-2 opacity-90">
              Your rides will appear in the Rides page as Garmin processes them. This may take a few minutes.
            </p>
          </div>

          {duplicatesFound > 0 && (
            <div className="alert-warning-dark">
              <p>
                ⚠ Found {duplicatesFound} existing duplicate ride{duplicatesFound === 1 ? '' : 's'}
              </p>
              <p className="text-sm mt-1 opacity-90">
                These rides exist in both Garmin and Strava. New duplicates may appear as Garmin syncs more rides.
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
  );
}
