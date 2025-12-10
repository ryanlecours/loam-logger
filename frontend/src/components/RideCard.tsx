// src/components/RideCard.tsx
import { useState } from 'react';
import { FaMountain } from 'react-icons/fa';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../graphql/updateRide';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import DeleteRideButton from './DeleteRideButton';
import EditRideModal from './EditRideModal';
import { fmtDateTime, fmtDuration, fmtMiles, fmtFeet } from '../lib/format';

type Ride = {
  id: string;
  garminActivityId?: string | null;
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

export default function RideCard({ ride, bikes = [] }: RideCardProps) {
  const [editing, setEditing] = useState(false);
  const [selectedBikeId, setSelectedBikeId] = useState<string>(bikes[0]?.id || '');
  const [isAssigning, setIsAssigning] = useState(false);

  const [updateRide] = useMutation(UPDATE_RIDE, {
    refetchQueries: [
      { query: RIDES, variables: { take: 5 } },
      { query: RIDES }, // Refetch all rides
      { query: BIKES }, // Refetch bikes to update component hours
    ],
  });

  const title =
    (ride.trailSystem?.trim() || ride.location?.trim())
      ? [ride.trailSystem?.trim(), ride.location?.trim()].filter(Boolean).join(' — ')
      : `${ride.rideType} ride`;

  const needsBikeAssignment = !ride.bikeId && bikes.length > 1;

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
      <li className="border rounded-lg p-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-medium truncate">{title}</div>
            {ride.garminActivityId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#11A9ED]/20 text-[#11A9ED] border border-[#11A9ED]/50">
                <FaMountain className="text-xs" />
                Garmin
              </span>
            )}
          </div>
          <div className="text-sm opacity-80 flex flex-wrap gap-3">
            <span>{fmtDateTime(Number(ride.startTime))}</span>
            <span>{fmtDuration(ride.durationSeconds)}</span>
            <span>{fmtMiles(ride.distanceMiles)}</span>
            <span>{fmtFeet(ride.elevationGainFeet)}</span>
            {typeof ride.averageHr === 'number' && <span>{ride.averageHr} bpm</span>}
          </div>
          {ride.notes && (
            <div className="mt-1 text-sm opacity-80 italic"
                 style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                 title={ride.notes}>
              {ride.notes}
            </div>
          )}

          {/* Bike assignment selector for multi-bike users */}
          {needsBikeAssignment && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-yellow-400">⚠️ Assign to bike:</span>
              <select
                value={selectedBikeId}
                onChange={(e) => setSelectedBikeId(e.target.value)}
                disabled={isAssigning}
                className="text-xs rounded-lg border border-app/60 bg-surface-2/70 px-2 py-1"
              >
                {bikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bike.nickname || `${bike.manufacturer} ${bike.model}`}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssignBike}
                disabled={isAssigning || !selectedBikeId}
                className="text-xs px-3 py-1 rounded-lg bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isAssigning ? 'Assigning...' : 'Confirm'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Edit button */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="p-2 rounded-lg border-2 border-accent/60 text-accent hover:bg-accent/20 hover:border-accent transition"
            title="Edit ride"
            aria-label="Edit ride"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82Z" />
            </svg>
          </button>

          {/* Delete button */}
          <DeleteRideButton id={ride.id} />
        </div>
      </li>

      {editing && <EditRideModal ride={ride} onClose={() => setEditing(false)} />}
    </>
  );
}
