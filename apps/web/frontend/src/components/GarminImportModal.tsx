import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function GarminImportModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'period' | 'processing' | 'complete'>('period');
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setStep('period');
      setDays(30);
      setError(null);
      setSuccessMessage(null);
      setIsDuplicate(false);
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
          setIsDuplicate(true);
          setStep('complete');
          onSuccess();
          return;
        }

        throw new Error(errorData.error || 'Failed to trigger backfill');
      }

      const data = await res.json();
      setSuccessMessage(data.message || `Backfill triggered for ${days} days. Your rides will sync automatically.`);
      setStep('complete');

      // Call onSuccess to show toast in parent
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backfill');
      setStep('period');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-2xl bg-surface border border-app rounded-3xl p-6 shadow-xl"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-2xl text-muted hover:text-white"
              disabled={step === 'processing'}
            >
              ×
            </button>

            <h2 className="text-2xl font-bold mb-4">Import Garmin Rides</h2>

            {/* Step 1: Select Time Period */}
            {step === 'period' && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm text-muted mb-4">
                    Trigger a backfill to import your historical Garmin cycling activities.
                    Garmin will send your rides via webhooks, and they'll appear automatically.
                  </p>

                  <label className="block text-sm font-medium mb-2">
                    Import rides from the last:
                  </label>
                  <select
                    value={days}
                    onChange={(e) => setDays(parseInt(e.target.value))}
                    className="w-full px-4 py-2 bg-surface-2 border border-app rounded-xl"
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>6 months</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>

                {error && (
                  <div className="p-4 bg-red-950/30 border border-red-600/50 rounded-xl">
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button onClick={onClose} className="btn-secondary">
                    Cancel
                  </button>
                  <button onClick={handleTriggerBackfill} className="btn-primary">
                    Trigger Import
                  </button>
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
                <div className={`p-4 rounded-xl ${
                  isDuplicate
                    ? 'bg-yellow-950/30 border border-yellow-600/50'
                    : 'bg-green-950/30 border border-green-600/50'
                }`}>
                  <p className={isDuplicate ? 'text-yellow-100' : 'text-green-100'}>
                    {isDuplicate ? '⚠' : '✓'} {successMessage}
                  </p>
                  <p className={`text-sm mt-2 ${isDuplicate ? 'text-yellow-200' : 'text-green-200'}`}>
                    Your rides will appear in the Rides page as Garmin processes them. This may take a few minutes.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button onClick={onClose} className="btn-primary">
                    Done
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
