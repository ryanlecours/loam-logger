import { useState, useEffect } from 'react';
import { Modal, Button } from './ui';
import { getAuthHeaders } from '@/lib/csrf';

type Ride = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  garminActivityId: string | null;
  stravaActivityId: string | null;
  rideType: string;
  notes: string | null;
  createdAt: string;
};

type DuplicateGroup = {
  id: string;
  startTime: string;
  distanceMiles: number;
  duplicates: Ride[];
  [key: string]: unknown;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function DuplicateRidesModal({ open, onClose }: Props) {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [autoMerging, setAutoMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchDuplicates();
      setError(null);
      setSuccessMessage(null);
    }
  }, [open]);

  // Auto-dismiss messages after 5 seconds
  useEffect(() => {
    if (error || successMessage) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, successMessage]);

  const fetchDuplicates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates`, {
        credentials: 'include',
      });
      const data = await res.json();
      setDuplicateGroups(data.duplicates || []);
    } catch (err) {
      console.error('Failed to fetch duplicates:', err);
      setError('Failed to load duplicates. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (keepId: string, deleteId: string) => {
    // Input validation
    if (!keepId || !deleteId) {
      setError('Invalid ride selection. Please try again.');
      return;
    }
    if (keepId === deleteId) {
      setError('Cannot merge a ride with itself.');
      return;
    }

    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/merge`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ keepRideId: keepId, deleteRideId: deleteId }),
      });

      if (!res.ok) throw new Error('Failed to merge');

      setSuccessMessage('Rides merged successfully.');
      // Refresh duplicates list
      await fetchDuplicates();
    } catch (err) {
      console.error('Failed to merge rides:', err);
      setError('Failed to merge rides. Please try again.');
    }
  };

  const handleMarkNotDuplicate = async (rideId: string) => {
    // Input validation
    if (!rideId) {
      setError('Invalid ride selection. Please try again.');
      return;
    }

    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/mark-not-duplicate`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rideId }),
      });

      if (!res.ok) throw new Error('Failed to mark');

      setSuccessMessage('Rides marked as not duplicates.');
      await fetchDuplicates();
    } catch (err) {
      console.error('Failed to mark ride:', err);
      setError('Failed to update ride. Please try again.');
    }
  };

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/scan`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) throw new Error('Failed to scan');

      const data = await res.json();
      setSuccessMessage(`Found ${data.duplicatesFound} duplicate ride pair${data.duplicatesFound !== 1 ? 's' : ''}.`);
      await fetchDuplicates();
    } catch (err) {
      console.error('Failed to scan for duplicates:', err);
      setError('Failed to scan for duplicates. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const handleAutoMerge = async () => {
    if (!confirm('This will automatically delete duplicate rides from your non-preferred data source. Continue?')) {
      return;
    }

    setAutoMerging(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/auto-merge`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to auto-merge');
      }

      setSuccessMessage(data.message || 'Auto-merge completed successfully.');
      await fetchDuplicates();
    } catch (err) {
      console.error('Failed to auto-merge duplicates:', err);
      setError(err instanceof Error ? err.message : 'Failed to auto-merge duplicates.');
    } finally {
      setAutoMerging(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Duplicate Rides"
      size="xl"
      footer={
        <div className="flex justify-between w-full">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleScan}
              disabled={scanning || autoMerging}
            >
              {scanning ? 'Scanning...' : 'Scan for Duplicates'}
            </Button>
            {duplicateGroups.length > 0 && (
              <Button
                variant="primary"
                onClick={handleAutoMerge}
                disabled={scanning || autoMerging}
              >
                {autoMerging ? 'Merging...' : 'Auto-merge All'}
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* Error message */}
      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div role="status" aria-live="polite" className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-xl text-green-200 text-sm">
          {successMessage}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-muted">Loading duplicates...</div>
      ) : duplicateGroups.length === 0 ? (
        <div className="py-8 text-center text-muted">
          <p>No duplicate rides found!</p>
          <p className="text-sm mt-2">Click "Scan for Duplicates" to check your ride history.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {duplicateGroups.map((group) => {
            const primaryRide = group as unknown as Ride;
            const primaryIsGarmin = !!primaryRide.garminActivityId;

            return (
              <div key={group.id} className="border border-app/50 rounded-2xl p-4 space-y-3">
                <p className="text-sm text-muted">
                  {new Date(group.startTime).toLocaleDateString()} - {group.distanceMiles.toFixed(1)} mi
                </p>

                {/* Primary ride */}
                <div className={`bg-surface-2 rounded-xl p-3 ${primaryIsGarmin ? 'border border-[#00a0df]/30' : 'border border-[#fc4c02]/30'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{primaryRide.notes || 'Ride'}</p>
                      <p className="text-xs text-muted">
                        Source: {primaryIsGarmin ? 'Garmin' : 'Strava'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted px-2 py-0.5 bg-surface-1 rounded">Primary</span>
                      {group.duplicates.map((dup) => (
                        <button
                          key={`keep-primary-${dup.id}`}
                          onClick={() => handleMerge(group.id, dup.id)}
                          aria-label={`Keep ${primaryIsGarmin ? 'Garmin' : 'Strava'} ride and delete duplicate`}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                            primaryIsGarmin
                              ? 'bg-[#00a0df]/20 border border-[#00a0df]/50 text-[#00a0df] hover:bg-[#00a0df]/30'
                              : 'bg-[#fc4c02]/20 border border-[#fc4c02]/50 text-[#fc4c02] hover:bg-[#fc4c02]/30'
                          }`}
                        >
                          Keep {primaryIsGarmin ? 'Garmin' : 'Strava'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Duplicate rides */}
                {group.duplicates.map((dup) => {
                  const dupIsGarmin = !!dup.garminActivityId;

                  return (
                    <div key={dup.id} className={`bg-surface-2 rounded-xl p-3 ${dupIsGarmin ? 'border border-[#00a0df]/30' : 'border border-[#fc4c02]/30'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{dup.notes || 'Ride'}</p>
                          <p className="text-xs text-muted">
                            Source: {dupIsGarmin ? 'Garmin' : 'Strava'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleMerge(dup.id, group.id)}
                          aria-label={`Keep ${dupIsGarmin ? 'Garmin' : 'Strava'} ride and delete primary`}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                            dupIsGarmin
                              ? 'bg-[#00a0df]/20 border border-[#00a0df]/50 text-[#00a0df] hover:bg-[#00a0df]/30'
                              : 'bg-[#fc4c02]/20 border border-[#fc4c02]/50 text-[#fc4c02] hover:bg-[#fc4c02]/30'
                          }`}
                        >
                          Keep {dupIsGarmin ? 'Garmin' : 'Strava'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Keep Both option - only show once per group */}
                {group.duplicates.length > 0 && (
                  <div className="flex justify-center pt-1">
                    <button
                      onClick={() => handleMarkNotDuplicate(group.duplicates[0].id)}
                      aria-label="Mark these rides as not duplicates and keep both"
                      className="text-xs px-4 py-1.5 text-muted hover:text-cream transition-colors"
                    >
                      These aren't duplicates - keep both rides
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
