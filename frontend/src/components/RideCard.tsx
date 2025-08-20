// src/components/RideCard.tsx
import { useState } from 'react';
import DeleteRideButton from './DeleteRideButton';
import EditRideModal from './EditRideModal';
import { fmtDateTime, fmtDuration, fmtMiles, fmtFeet } from '../lib/format';

type Ride = {
  id: string;
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

export default function RideCard({ ride }: { ride: Ride }) {
  const [editing, setEditing] = useState(false);
  const title =
    (ride.trailSystem?.trim() || ride.location?.trim())
      ? [ride.trailSystem?.trim(), ride.location?.trim()].filter(Boolean).join(' — ')
      : `${ride.rideType} ride`;

  return (
    <>
      <li className="border rounded-lg p-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{title}</div>
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
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Edit button */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center p-1 rounded hover:bg-gray-50 border border-transparent hover:border-gray-200"
            title="Edit ride"
            aria-label="Edit ride"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
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
