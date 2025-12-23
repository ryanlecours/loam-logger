import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { BIKES } from '../graphql/bikes';
import { CREATE_STRAVA_GEAR_MAPPING } from '../graphql/stravaGear';
import { Modal, Select, Button } from './ui';

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
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Map Strava Bikes"
      subtitle={trigger === 'import'
        ? 'Your Strava import includes bikes that need to be mapped to your Loam Logger bikes.'
        : 'New rides from Strava include bikes that need to be mapped to your Loam Logger bikes.'}
      size="lg"
    >
      <div className="mb-6">
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

      <Select
        label="Map to Loam Logger Bike"
        value={selectedBikeId}
        onChange={(e) => setSelectedBikeId(e.target.value)}
        containerClassName="mb-6"
      >
        <option value="">Select a bike...</option>
        {bikes.map((bike) => (
          <option key={bike.id} value={bike.id}>
            {bike.nickname || `${bike.manufacturer} ${bike.model}`}
          </option>
        ))}
      </Select>

      <div className="flex gap-3">
        <Button
          variant="secondary"
          onClick={handleSkip}
          disabled={creatingMapping}
          className="flex-1"
        >
          {currentGearIndex < unmappedGears.length - 1 ? 'Skip for Now' : 'Done'}
        </Button>
        <Button
          variant="primary"
          onClick={handleMapBike}
          disabled={!selectedBikeId || creatingMapping}
          className="flex-1"
        >
          {creatingMapping ? 'Mapping...' : 'Map Bike'}
        </Button>
      </div>

      <div className="mt-4 text-sm text-muted">
        <p>
          Mapping this bike will automatically assign all past rides with this Strava bike
          to your Loam Logger bike and update component hours.
        </p>
      </div>
    </Modal>
  );
}
