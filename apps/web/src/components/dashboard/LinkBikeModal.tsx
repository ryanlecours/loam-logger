import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../../graphql/updateRide';
import { RIDES } from '../../graphql/rides';
import { Modal, Select, Button } from '../ui';
import { getBikeName, formatRideDate, formatDurationCompact } from '../../utils/formatters';
import { getRideSource, SOURCE_LABELS } from '../../utils/rideSource';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  trailSystem?: string | null;
  location?: string | null;
  bikeId?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

interface Bike {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
}

interface LinkBikeModalProps {
  ride: Ride | null;
  bikes: Bike[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function LinkBikeModal({ ride, bikes, onClose, onSuccess }: LinkBikeModalProps) {
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [updateRide, { loading }] = useMutation(UPDATE_RIDE, {
    refetchQueries: [{ query: RIDES, variables: { take: 10 } }],
    onCompleted: () => {
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  if (!ride) return null;

  const rideName = ride.trailSystem || ride.location || 'Ride';
  const rideDate = formatRideDate(ride.startTime);
  const duration = formatDurationCompact(ride.durationSeconds);
  const distance = ride.distanceMiles?.toFixed(1) ?? '0';
  const elevation = Math.round(ride.elevationGainFeet ?? 0).toLocaleString();
  const source = getRideSource(ride);

  const handleSave = async () => {
    if (!selectedBikeId) {
      setError('Please select a bike');
      return;
    }

    setError(null);
    await updateRide({
      variables: {
        id: ride.id,
        input: {
          bikeId: selectedBikeId,
        },
      },
    });
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Link Bike to Ride"
      size="md"
      preventClose={loading}
    >
      <div className="space-y-4">
        <div className="bg-highlight/30 border border-app rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="font-semibold text-white text-lg">{rideName}</h3>
            <span className={`source-badge source-badge-${source} flex-shrink-0`}>
              {SOURCE_LABELS[source]}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span className="text-muted">Date</span>
              <p className="text-white">{rideDate}</p>
            </div>
            <div>
              <span className="text-muted">Duration</span>
              <p className="text-white">{duration}</p>
            </div>
            <div>
              <span className="text-muted">Distance</span>
              <p className="text-white">{distance} mi</p>
            </div>
            <div>
              <span className="text-muted">Elevation</span>
              <p className="text-white">{elevation} ft</p>
            </div>
            {ride.location && ride.trailSystem && (
              <div className="col-span-2">
                <span className="text-muted">Location</span>
                <p className="text-white">{ride.location}</p>
              </div>
            )}
          </div>
        </div>

        <Select
          label="Select Bike"
          value={selectedBikeId}
          onChange={(e) => {
            setSelectedBikeId(e.target.value);
            setError(null);
          }}
        >
          <option value="">Choose a bike...</option>
          {bikes.map((bike) => (
            <option key={bike.id} value={bike.id}>
              {getBikeName(bike)}
            </option>
          ))}
        </Select>

        {error && (
          <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!selectedBikeId || loading}
          >
            {loading ? 'Linking...' : 'Link Bike'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
