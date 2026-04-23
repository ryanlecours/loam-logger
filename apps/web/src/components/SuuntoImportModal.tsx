import { useState, useEffect, useMemo } from 'react';
import { Check } from 'lucide-react';
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
  provider: 'strava' | 'garmin' | 'whoop' | 'suunto';
  year: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  ridesFound: number | null;
  backfilledUpTo: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const CURRENT_YEAR = new Date().getFullYear();

const YEAR_OPTIONS = [
  { value: 'ytd', label: `Year to Date (${CURRENT_YEAR})` },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(CURRENT_YEAR - 1 - i),
    label: String(CURRENT_YEAR - 1 - i),
  })),
];

export default function SuuntoImportModal({ open, onClose, onSuccess, onDuplicatesFound }: Props) {
  // Uses POST /api/suunto/backfill/batch — returns immediately after enqueuing
  // jobs into the backfill worker. Multi-year selection mirrors Garmin's modal.
  // The previous version called the synchronous GET /api/suunto/backfill/fetch
  // which blocked the browser until import completed (minutes for users with
  // years of history) and only handled one year per request.
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set(['ytd']));
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [duplicatesFound, setDuplicatesFound] = useState(0);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const backfilledYears = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'suunto' &&
            req.year !== 'ytd' &&
            req.status !== 'failed'
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  const inProgressYears = useMemo(() => {
    return new Set(
      backfillHistory
        .filter(
          (req) =>
            req.provider === 'suunto' &&
            (req.status === 'in_progress' || req.status === 'pending')
        )
        .map((req) => req.year)
    );
  }, [backfillHistory]);

  const canSelectYear = (yearValue: string): boolean => {
    if (yearValue === 'ytd') {
      return !inProgressYears.has('ytd');
    }
    return !backfilledYears.has(yearValue) && !inProgressYears.has(yearValue);
  };

  const getYearStatus = (yearValue: string): 'backfilled' | 'in_progress' | 'available' => {
    if (inProgressYears.has(yearValue)) return 'in_progress';
    if (backfilledYears.has(yearValue)) return 'backfilled';
    return 'available';
  };

  const toggleYearSelection = (yearValue: string) => {
    if (!canSelectYear(yearValue)) return;
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(yearValue)) {
        next.delete(yearValue);
      } else {
        next.add(yearValue);
      }
      return next;
    });
  };

  const selectableYearsCount = selectedYears.size;

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
        `${import.meta.env.VITE_API_URL}/api/suunto/backfill/batch`,
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

      await fetchHistory();

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
      title="Import Suunto Rides"
      size="lg"
      preventClose={step === 'processing'}
    >
      {step === 'period' && (
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted mb-4">
              Import your historical Suunto workouts by year. Selected years will be queued
              and processed in the background — you can close this modal once they're queued.
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
                  const status = getYearStatus(option.value);
                  const isBackfilled = status === 'backfilled';
                  const isInProgress = status === 'in_progress';
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
                        onChange={() => toggleYearSelection(option.value)}
                        className="w-4 h-4 text-accent border-gray-500 focus:ring-accent rounded"
                      />
                      <span className={`flex-1 text-sm ${isDisabled ? 'text-muted' : 'text-primary'}`}>
                        {option.label}
                      </span>
                      {isBackfilled && (
                        <span title="Already imported"><Check className="w-3 h-3 text-green-400" /></span>
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
              Year to Date can be run multiple times to fetch new workouts since your last import.
            </p>
            <p className="text-xs text-muted mt-1">
              Note: Suunto's workout list doesn't include gear mapping, so rides will be auto-assigned to your bike if you only have one.
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

      {step === 'processing' && (
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted">Queuing backfill request...</p>
          </div>
        </div>
      )}

      {step === 'complete' && (
        <div className="space-y-6">
          <div className="alert-success-dark">
            <p>
              ✓ {successMessage}
            </p>
            <p className="text-sm mt-2 opacity-90">
              Your rides will appear in the Rides page as Suunto data is processed.
              This may take a few minutes per year.
            </p>
          </div>

          {duplicatesFound > 0 && (
            <div className="alert-warning-dark">
              <p>
                ⚠ Found {duplicatesFound} existing duplicate ride{duplicatesFound === 1 ? '' : 's'}
              </p>
              <p className="text-sm mt-1 opacity-90">
                These rides may exist across multiple providers. Review them to keep only one copy.
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
