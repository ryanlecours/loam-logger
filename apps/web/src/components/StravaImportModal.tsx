import { useState, useEffect } from 'react';
import StravaGearMappingModal from './StravaGearMappingModal';
import { Modal, Select, Button } from './ui';
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
      setDuplicatesFound(0);
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

              <Select
                label="Select Year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                hint={year === 'ytd'
                  ? `Import all rides from January 1, ${new Date().getFullYear()} to today`
                  : `Import all rides from ${year}`
                }
              >
                <option value="ytd">Year to Date ({new Date().getFullYear()})</option>
                <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
                <option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option>
                <option value={new Date().getFullYear() - 2}>{new Date().getFullYear() - 2}</option>
                <option value={new Date().getFullYear() - 3}>{new Date().getFullYear() - 3}</option>
                <option value={new Date().getFullYear() - 4}>{new Date().getFullYear() - 4}</option>
                <option value={new Date().getFullYear() - 5}>{new Date().getFullYear() - 5}</option>
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
              <Button variant="primary" onClick={handleTriggerImport}>
                Import Rides
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Processing */}
        {step === 'processing' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
              <p className="text-muted">Importing activities from Strava...</p>< br/>
              <p className="text-muted text-center">Depending on how many rides you have completed,< br/>this may take 1-2 minutes.</p>
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
