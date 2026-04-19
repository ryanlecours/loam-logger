import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../graphql/updateRide';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import DeleteRideButton from './DeleteRideButton';
import EditRideModal from './EditRideModal';
import { fmtDateTime, fmtDuration, fmtDistance, fmtElevation } from '../lib/format';
import { usePreferences } from '../hooks/usePreferences';
import { Select } from './ui';
import { getRideSource, SOURCE_LABELS } from '../utils/rideSource';
import WeatherBadge from './WeatherBadge';
import type { RideWeather } from '../models/Ride';

type Ride = {
  id: string;
  garminActivityId?: string | null;
  stravaActivityId?: string | null;
  whoopWorkoutId?: string | null;
  startTime: string | number | Date;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
  weather?: RideWeather | null;
};

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

type RideCardProps = {
  ride: Ride;
  bikes?: Bike[];
};

const formatTitle = (ride: Ride) => {
  const trimmedLocation = ride.location?.trim();
  const trimmedTrail = ride.trailSystem?.trim();
  const titleParts = [trimmedLocation, trimmedTrail].filter(
    (part): part is string => Boolean(part)
  );
  return titleParts.length ? titleParts.join(' — ') : `${ride.rideType} ride`;
};

export default function RideCard({ ride, bikes = [] }: RideCardProps) {
  const [editing, setEditing] = useState(false);
  const [selectedBikeId, setSelectedBikeId] = useState<string>(bikes[0]?.id || '');
  const [isAssigning, setIsAssigning] = useState(false);
  const { distanceUnit } = usePreferences();

  const [updateRide] = useMutation(UPDATE_RIDE, {
    refetchQueries: [
      { query: RIDES, variables: { take: 5 } },
      { query: RIDES },
      { query: BIKES },
    ],
  });

  const title = formatTitle(ride);
  const needsBikeAssignment = !ride.bikeId && bikes.length > 1;
  const source = getRideSource(ride);

  const handleAssignBike = async () => {
    if (!selectedBikeId) return;

    setIsAssigning(true);
    try {
      await updateRide({
        variables: {
          id: ride.id,
          input: {
            bikeId: selectedBikeId,
          },
        },
      });
    } catch (err) {
      console.error('Failed to assign bike:', err);
      alert('Failed to assign bike. Please try again.');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <>
      <div
        className="ride-card-container cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
      >
        <div className="ride-content">
          <div className="ride-header">
            <h3 className="ride-title" title={title}>{title}</h3>
            <span className={`source-badge source-badge-${source}`}>
              {SOURCE_LABELS[source]}
            </span>
          </div>

          <div className="ride-metadata">
            <span className="meta-item">{fmtDateTime(ride.startTime)}</span>
            <span className="meta-item">{fmtDuration(ride.durationSeconds)}</span>
            <span className="meta-item">{fmtDistance(ride.distanceMeters, distanceUnit)}</span>
            <span className="meta-item">{fmtElevation(ride.elevationGainMeters)}</span>
            {typeof ride.averageHr === 'number' && (
              <span className="meta-item">{ride.averageHr} bpm</span>
            )}
            {ride.weather && (
              <span className="meta-item">
                <WeatherBadge weather={ride.weather} distanceUnit={distanceUnit} />
              </span>
            )}
          </div>

          {ride.notes && (
            <div className="ride-notes" title={ride.notes}>
              {ride.notes}
            </div>
          )}

          {needsBikeAssignment && (
            <div className="bike-assignment" onClick={(e) => e.stopPropagation()}>
              <span className="assignment-label">Assign to bike:</span>
              <Select
                value={selectedBikeId}
                onChange={(e) => setSelectedBikeId(e.target.value)}
                disabled={isAssigning}
                className="assignment-select flex-1"
              >
                {bikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bike.nickname || `${bike.manufacturer} ${bike.model}`}
                  </option>
                ))}
              </Select>
              <button
                onClick={handleAssignBike}
                disabled={isAssigning || !selectedBikeId}
                className="assignment-btn"
              >
                {isAssigning ? 'Assigning...' : 'Confirm'}
              </button>
            </div>
          )}
        </div>

        <div className="ride-actions" onClick={(e) => e.stopPropagation()}>
          <DeleteRideButton id={ride.id} />
        </div>
      </div>

      {editing && <EditRideModal ride={ride} onClose={() => setEditing(false)} />}
    </>
  );
}
