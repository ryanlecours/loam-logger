import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rideId }),
      });

      if (!res.ok) throw new Error('Failed to mark');

      await fetchDuplicates();
    } catch (error) {
      console.error('Failed to mark ride:', error);
      alert('Failed to mark ride');
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
            className="relative w-full max-w-4xl bg-surface border border-app rounded-3xl p-6 shadow-xl max-h-[80vh] overflow-y-auto"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-2xl text-muted hover:text-white"
            >
              ×
            </button>

            <h2 className="text-2xl font-bold mb-4">Duplicate Rides</h2>

            {loading ? (
              <div className="py-8 text-center text-muted">Loading duplicates...</div>
            ) : duplicateGroups.length === 0 ? (
              <div className="py-8 text-center text-muted">
                No duplicate rides found! 🎉
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

            <div className="mt-6 flex justify-end">
              <button onClick={onClose} className="btn-secondary">
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
