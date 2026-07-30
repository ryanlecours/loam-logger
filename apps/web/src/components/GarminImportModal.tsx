import { useState, useEffect, useMemo } from 'react';
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

// Rolling windows, shortest first. They nest (7 days is inside 30), so this is
// a single choice rather than a multi-select. The API calls these periods and
// still receives them under the legacy `years` body field.
const GARMIN_PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '14d', label: 'Last 14 Days' },
  { value: '30d', label: 'Last 30 Days' },
];

const DEFAULT_PERIOD = '30d';

const periodLabel = (value: string) =>
  GARMIN_PERIOD_OPTIONS.find((option) => option.value === value)?.label ?? value;

export default function GarminImportModal({ open, onClose, onSuccess, onDuplicatesFound }: Props) {
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [selectedPeriod, setSelectedPeriod] = useState<string>(DEFAULT_PERIOD);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [backfillHistory, setBackfillHistory] = useState<BackfillRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [duplicatesFound, setDuplicatesFound] = useState(0);

  // Periods with a sync already queued or running
  const inProgressPeriods = useMemo(() => {
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

  const selectedIsInProgress = inProgressPeriods.has(selectedPeriod);

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
      setSelectedPeriod(DEFAULT_PERIOD);
      setError(null);
      setSuccessMessage(null);
      setDuplicatesFound(0);
      setHistoryLoading(true);
    }
  }, [open]);

  const handleTriggerBackfill = async () => {
    if (!selectedPeriod) {
      setError('Please select a time period');
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
          // Legacy field name: shipped clients all post `years`, and the API
          // reads each entry as a period key.
          body: JSON.stringify({ years: [selectedPeriod] }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        // Handle 409 Conflict (all years already backfilled)
        if (res.status === 409) {
          setSuccessMessage(data.message || 'That time period is already syncing.');
          setStep('complete');
          await fetchHistory();
          return;
        }

        throw new Error(data.message || data.error || 'Failed to trigger backfill');
      }

      setSuccessMessage(
        data.message || `Queued the ${periodLabel(selectedPeriod).toLowerCase()} for import.`
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
              Import your recent Garmin cycling activities.
              Garmin will send your rides via webhooks, and they'll appear automatically.
            </p>

            {historyLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted py-4">
                <div className="w-4 h-4 border border-muted border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="space-y-3">
                {GARMIN_PERIOD_OPTIONS.map((option) => {
                  const isInProgress = inProgressPeriods.has(option.value);
                  const isSelected = selectedPeriod === option.value;

                  return (
                    <label
                      key={option.value}
                      className={`
                        flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors
                        ${isInProgress ? 'opacity-50 cursor-not-allowed' : ''}
                        ${isSelected && !isInProgress
                          ? 'border-accent bg-accent/10'
                          : 'border-app hover:border-accent/50'}
                      `}
                    >
                      <input
                        type="radio"
                        name="garmin-import-period"
                        value={option.value}
                        checked={isSelected}
                        disabled={isInProgress}
                        onChange={() => !isInProgress && setSelectedPeriod(option.value)}
                        className="w-4 h-4 text-accent border-gray-500 focus:ring-accent"
                      />
                      <span className={`flex-1 text-sm ${isInProgress ? 'text-muted' : 'text-primary'}`}>
                        {option.label}
                      </span>
                      {isInProgress && (
                        <div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" title="In progress" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            <p className="text-xs text-muted mt-2">
              Garmin sends the rides in the window you pick. New rides keep syncing automatically, and you
              can run this again anytime to catch anything missed.
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
              disabled={!selectedPeriod || selectedIsInProgress || historyLoading}
            >
              {selectedIsInProgress
                ? 'Sync In Progress'
                : `Import ${periodLabel(selectedPeriod)}`}
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
