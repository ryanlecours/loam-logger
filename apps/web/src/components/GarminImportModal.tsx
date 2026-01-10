import { useState, useEffect } from 'react';
import { Modal, Select, Button } from './ui';
import { getAuthHeaders } from '@/lib/csrf';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onDuplicatesFound?: (count: number) => void;
};

export default function GarminImportModal({ open, onClose, onSuccess, onDuplicatesFound }: Props) {
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDuplicateRequest, setIsDuplicateRequest] = useState(false);
  const [duplicatesFound, setDuplicatesFound] = useState(0);

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setStep('period');
      setDays(30);
      setError(null);
      setSuccessMessage(null);
      setIsDuplicateRequest(false);
      setDuplicatesFound(0);
    }
  }, [open]);

  const handleTriggerBackfill = async () => {
    setError(null);
    setStep('processing');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/garmin/backfill/fetch?days=${days}`,
        {
          credentials: 'include',
        }
      );

      if (!res.ok) {
        const errorData = await res.json();

        // Handle 409 Conflict (duplicate backfill request) specially
        if (res.status === 409) {
          setSuccessMessage(errorData.message || 'A backfill for this time period is already in progress.');
          setIsDuplicateRequest(true);
          setStep('complete');
          onSuccess();
          return;
        }

        throw new Error(errorData.error || 'Failed to trigger backfill');
      }

      const data = await res.json();
      setSuccessMessage(data.message || `Backfill triggered for ${days} days. Your rides will sync automatically.`);
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
      {/* Step 1: Select Time Period */}
      {step === 'period' && (
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted mb-4">
              Trigger a backfill to import your historical Garmin cycling activities.
              Garmin will send your rides via webhooks, and they'll appear automatically.
            </p>

            <Select
              label="Import rides from the last:"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </Select>
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
            <Button variant="primary" onClick={handleTriggerBackfill}>
              Trigger Import
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Processing */}
      {step === 'processing' && (
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted">Triggering backfill request...</p>
          </div>
        </div>
      )}

      {/* Step 3: Complete */}
      {step === 'complete' && (
        <div className="space-y-6">
          <div className={isDuplicateRequest ? 'alert-warning-dark' : 'alert-success-dark'}>
            <p>
              {isDuplicateRequest ? '⚠' : '✓'} {successMessage}
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
