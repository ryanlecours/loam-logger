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

  useEffect(() => {
    if (open) {
      fetchDuplicates();
    }
  }, [open]);

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates`, {
        credentials: 'include',
      });
      const data = await res.json();
      setDuplicateGroups(data.duplicates || []);
    } catch (error) {
      console.error('Failed to fetch duplicates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (keepId: string, deleteId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/merge`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ keepRideId: keepId, deleteRideId: deleteId }),
      });

      if (!res.ok) throw new Error('Failed to merge');

      // Refresh duplicates list
      await fetchDuplicates();
    } catch (error) {
      console.error('Failed to merge rides:', error);
      alert('Failed to merge rides');
    }
  };

  const handleMarkNotDuplicate = async (rideId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/mark-not-duplicate`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rideId }),
      });

      if (!res.ok) throw new Error('Failed to mark');

      await fetchDuplicates();
    } catch (error) {
      console.error('Failed to mark ride:', error);
      alert('Failed to mark ride');
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/duplicates/scan`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) throw new Error('Failed to scan');

      const data = await res.json();
      alert(`Found ${data.duplicatesFound} duplicate ride pairs`);
      await fetchDuplicates();
    } catch (error) {
      console.error('Failed to scan for duplicates:', error);
      alert('Failed to scan for duplicates');
    } finally {
      setScanning(false);
    }
  };

  const handleAutoMerge = async () => {
    if (!confirm('This will automatically delete duplicate rides from your non-preferred data source. Continue?')) {
      return;
    }

    setAutoMerging(true);
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

      alert(data.message);
      await fetchDuplicates();
    } catch (error) {
      console.error('Failed to auto-merge duplicates:', error);
      alert(error instanceof Error ? error.message : 'Failed to auto-merge duplicates');
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
      {loading ? (
        <div className="py-8 text-center text-muted">Loading duplicates...</div>
      ) : duplicateGroups.length === 0 ? (
        <div className="py-8 text-center text-muted">
          <p>No duplicate rides found!</p>
          <p className="text-sm mt-2">Click "Scan for Duplicates" to check your ride history.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {duplicateGroups.map((group) => (
            <div key={group.id} className="border border-app/50 rounded-2xl p-4 space-y-3">
              <p className="text-sm text-muted">
                {new Date(group.startTime).toLocaleDateString()} - {group.distanceMiles.toFixed(1)} mi
              </p>

              {/* Primary ride */}
              <div className="bg-surface-2 border border-green-600/30 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{(group as unknown as Ride).notes || 'Ride'}</p>
                    <p className="text-xs text-muted">
                      Source: {(group as unknown as Ride).garminActivityId ? 'Garmin' : 'Strava'}
                    </p>
                  </div>
                  <span className="text-xs text-green-400">Primary</span>
                </div>
              </div>

              {/* Duplicate rides */}
              {group.duplicates.map((dup) => (
                <div key={dup.id} className="bg-surface-2 border border-yellow-600/30 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{dup.notes || 'Ride'}</p>
                      <p className="text-xs text-muted">
                        Source: {dup.garminActivityId ? 'Garmin' : 'Strava'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleMerge(group.id, dup.id)}
                        className="text-xs px-3 py-1 bg-red-600/20 border border-red-600/50 text-red-400 rounded-lg hover:bg-red-600/30"
                      >
                        Delete This
                      </button>
                      <button
                        onClick={() => handleMerge(dup.id, group.id)}
                        className="text-xs px-3 py-1 bg-green-600/20 border border-green-600/50 text-green-400 rounded-lg hover:bg-green-600/30"
                      >
                        Keep This
                      </button>
                      <button
                        onClick={() => handleMarkNotDuplicate(dup.id)}
                        className="text-xs px-3 py-1 bg-blue-600/20 border border-blue-600/50 text-blue-400 rounded-lg hover:bg-blue-600/30"
                      >
                        Not Duplicate
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
