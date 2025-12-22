import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation } from '@apollo/client';
import { BIKES } from '../graphql/bikes';
import { CREATE_STRAVA_GEAR_MAPPING } from '../graphql/stravaGear';

type UnmappedGear = {
  gearId: string;
  gearName?: string | null;
  rideCount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  unmappedGears: UnmappedGear[];
  trigger: 'import' | 'webhook';
};

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

export default function StravaGearMappingModal({
  open,
  onClose,
  onSuccess,
  unmappedGears,
  trigger,
}: Props) {
  const [currentGearIndex, setCurrentGearIndex] = useState(0);
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [gearNames, setGearNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: bikesData } = useQuery(BIKES);
  const [createMapping, { loading: creatingMapping }] = useMutation(CREATE_STRAVA_GEAR_MAPPING);

  const bikes: Bike[] = bikesData?.bikes || [];
  const currentGear = unmappedGears[currentGearIndex];

  useEffect(() => {
    if (!open) {
      setCurrentGearIndex(0);
      setSelectedBikeId('');
      setGearNames({});
      setError(null);
    }
  }, [open]);

  // Fetch gear names from Strava API
  useEffect(() => {
    if (open && currentGear && !gearNames[currentGear.gearId]) {
      fetchGearName(currentGear.gearId);
    }
  }, [open, currentGear, gearNames]);

  const fetchGearName = async (gearId: string) => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/strava/gear/${gearId}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setGearNames((prev) => ({
          ...prev,
          [gearId]: data.name || gearId,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch gear name:', err);
    }
  };

  const handleMapBike = async () => {
    if (!selectedBikeId || !currentGear) return;

    setError(null);
    try {
      await createMapping({
        variables: {
          input: {
            stravaGearId: currentGear.gearId,
            stravaGearName: gearNames[currentGear.gearId] || null,
            bikeId: selectedBikeId,
          },
        },
      });

      // Move to next gear or close if done
      if (currentGearIndex < unmappedGears.length - 1) {
        setCurrentGearIndex(currentGearIndex + 1);
        setSelectedBikeId('');
      } else {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping');
    }
  };

  const handleSkip = () => {
    if (currentGearIndex < unmappedGears.length - 1) {
      setCurrentGearIndex(currentGearIndex + 1);
      setSelectedBikeId('');
    } else {
      onClose();
    }
  };

  if (!currentGear) return null;

  const gearDisplayName = gearNames[currentGear.gearId] || currentGear.gearId;

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
            >
              ×
            </button>

            <h2 className="text-2xl font-bold text-white mb-4">
              Map Strava Bikes
            </h2>

            <div className="mb-6">
              <p className="text-muted mb-2">
                {trigger === 'import'
                  ? 'Your Strava import includes bikes that need to be mapped to your Loam Logger bikes.'
                  : 'New rides from Strava include bikes that need to be mapped to your Loam Logger bikes.'}
              </p>
              <p className="text-sm text-muted">
                Progress: {currentGearIndex + 1} of {unmappedGears.length}
              </p>
            </div>

            <div className="bg-highlight/30 border border-app rounded-2xl p-4 mb-6">
              <h3 className="text-lg font-semibold text-white mb-2">
                Strava Bike: {gearDisplayName}
              </h3>
              <p className="text-sm text-muted">
                Used in {currentGear.rideCount} {currentGear.rideCount === 1 ? 'ride' : 'rides'}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200">
                {error}
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-medium text-muted mb-2">
                Map to Loam Logger Bike
              </label>
              <select
                value={selectedBikeId}
                onChange={(e) => setSelectedBikeId(e.target.value)}
                className="w-full bg-highlight border border-app rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Select a bike...</option>
                {bikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bike.nickname || `${bike.manufacturer} ${bike.model}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSkip}
                className="flex-1 bg-highlight hover:bg-highlight-hover border border-app rounded-xl px-6 py-3 text-white font-medium transition-colors"
                disabled={creatingMapping}
              >
                {currentGearIndex < unmappedGears.length - 1 ? 'Skip for Now' : 'Done'}
              </button>
              <button
                onClick={handleMapBike}
                disabled={!selectedBikeId || creatingMapping}
                className="flex-1 bg-accent hover:bg-accent-hover text-white font-medium px-6 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingMapping ? 'Mapping...' : 'Map Bike'}
              </button>
            </div>

            <div className="mt-4 text-sm text-muted">
              <p>
                Mapping this bike will automatically assign all past rides with this Strava bike
                to your Loam Logger bike and update component hours.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
