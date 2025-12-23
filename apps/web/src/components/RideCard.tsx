import { useState } from 'react';
import { FaMountain, FaPencilAlt, FaStrava } from 'react-icons/fa';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../graphql/updateRide';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import DeleteRideButton from './DeleteRideButton';
import EditRideModal from './EditRideModal';
import { fmtDateTime, fmtDuration, fmtMiles, fmtFeet } from '../lib/format';
import { Badge, Select } from './ui';

type Ride = {
  id: string;
  garminActivityId?: string | null;
  stravaActivityId?: string | null;
  startTime: string | number | Date;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
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

type RideSource = 'garmin' | 'strava' | 'manual';

const getRideSource = (ride: Ride): RideSource => {
  if (ride.garminActivityId) return 'garmin';
  if (ride.stravaActivityId) return 'strava';
  return 'manual';
};

const SOURCE_BADGES: Record<
  RideSource,
  { label: string; color: string; Icon: typeof FaMountain }
> = {
  garmin: { label: 'Garmin', color: '#11A9ED', Icon: FaMountain },
  strava: { label: 'Strava', color: '#FC4C02', Icon: FaStrava },
  manual: { label: 'Manual', color: '#9CA3AF', Icon: FaPencilAlt },
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
  const sourceBadge = SOURCE_BADGES[source];

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
      <div className="ride-card-container">
        <div className="ride-content">
          <div className="ride-header">
            <h3 className="ride-title" title={title}>{title}</h3>
            {sourceBadge && (
              <Badge
                variant="custom"
                color={sourceBadge.color}
                icon={<sourceBadge.Icon />}
                title={
                  source === 'garmin'
                    ? 'From Garmin Connect'
                    : source === 'strava'
                      ? 'From Strava'
                      : 'Manual entry'
                }
              >
                {sourceBadge.label}
              </Badge>
            )}
          </div>

          <div className="ride-metadata">
            <span className="meta-item">{fmtDateTime(Number(ride.startTime))}</span>
            <span className="meta-item">{fmtDuration(ride.durationSeconds)}</span>
            <span className="meta-item">{fmtMiles(ride.distanceMiles)}</span>
            <span className="meta-item">{fmtFeet(ride.elevationGainFeet)}</span>
            {typeof ride.averageHr === 'number' && (
              <span className="meta-item">{ride.averageHr} bpm</span>
            )}
          </div>

          {ride.notes && (
            <div className="ride-notes" title={ride.notes}>
              {ride.notes}
            </div>
          )}

          {needsBikeAssignment && (
            <div className="bike-assignment">
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

        <div className="ride-actions">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ride-action-btn"
            title="Edit ride"
            aria-label="Edit ride"
          >
            <svg className="action-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82Z" />
            </svg>
          </button>

          <DeleteRideButton id={ride.id} />
        </div>
      </div>

      {editing && <EditRideModal ride={ride} onClose={() => setEditing(false)} />}
    </>
  );
}
