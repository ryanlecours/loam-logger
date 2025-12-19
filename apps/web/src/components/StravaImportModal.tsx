import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import StravaGearMappingModal from './StravaGearMappingModal';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type UnmappedGear = {
  gearId: string;
  rideCount: number;
};

export default function StravaImportModal({ open, onClose, onSuccess }: Props) {
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

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setStep('period');
      setYear('ytd');
      setError(null);
      setSuccessMessage(null);
      setImportStats(null);
      setUnmappedGears([]);
      setShowGearMapping(false);
    }
  }, [open]);

  const handleTriggerImport = async () => {
    setError(null);
    setStep('processing');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/strava/backfill/fetch?year=${year}`,
        {
          credentials: 'include',
        }
      );

      if (!res.ok) {
        const errorData = await res.json();
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

      // Call onSuccess to trigger parent refresh
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import activities');
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

            <h2 className="text-2xl font-bold mb-4">Import Strava Rides</h2>

            {/* Step 1: Select Year */}
            {step === 'period' && (
              <div className="space-y-6">
                <div>
                  <p className="text-sm text-muted mb-4">
                    Import your historical Strava cycling activities by year.
                    Activities will be fetched and imported immediately.
                  </p>

                  <label className="block text-sm font-medium mb-2">
                    Select Year
                  </label>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full px-4 py-2 bg-surface-2 border border-app rounded-xl"
                  >
                    <option value="ytd">Year to Date ({new Date().getFullYear()})</option>
                    <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
                    <option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option>
                    <option value={new Date().getFullYear() - 2}>{new Date().getFullYear() - 2}</option>
                    <option value={new Date().getFullYear() - 3}>{new Date().getFullYear() - 3}</option>
                    <option value={new Date().getFullYear() - 4}>{new Date().getFullYear() - 4}</option>
                    <option value={new Date().getFullYear() - 5}>{new Date().getFullYear() - 5}</option>
                  </select>
                  <p className="text-xs text-muted mt-2">
                    {year === 'ytd'
                      ? `Import all rides from January 1, ${new Date().getFullYear()} to today`
                      : `Import all rides from ${year}`
                    }
                  </p>
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
                  <button onClick={handleTriggerImport} className="btn-primary">
                    Import Rides
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Processing */}
            {step === 'processing' && (
              <div className="space-y-6">
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                  <p className="text-muted">Importing activities from Strava...</p>
                </div>
              </div>
            )}

            {/* Step 3: Complete */}
            {step === 'complete' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-green-950/30 border border-green-600/50">
                  <p className="text-green-100">
                    ✓ {successMessage}
                  </p>
                  {importStats && (
                    <div className="text-sm mt-3 text-green-200 space-y-1">
                      <p className="font-medium">Import completed for {year === 'ytd' ? 'Year to Date' : year}</p>
                      <p>• Imported: {importStats.imported} rides</p>
                      <p>• Skipped (already exist): {importStats.skipped} rides</p>
                      <p>• Total cycling activities found: {importStats.total}</p>
                      {unmappedGears.length > 0 && (
                        <p className="text-yellow-300">• {unmappedGears.length} unmapped bike(s) - visit Gear page to map</p>
                      )}
                    </div>
                  )}
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
    </AnimatePresence>
  );
}
