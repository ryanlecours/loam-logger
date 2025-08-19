import DeleteRideButton from './DeleteRideButton';
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
  trailSystem?: string | null;  // NEW
  location?: string | null;     // NEW
};

export default function RideCard({ ride }: { ride: Ride }) {
  const title =
    (ride.trailSystem?.trim() || ride.location?.trim())
      ? [ride.trailSystem?.trim(), ride.location?.trim()].filter(Boolean).join(' — ')
      : `${ride.rideType} ride`;

  return (
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
          <div
            className="mt-1 text-sm opacity-80 italic"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            title={ride.notes}
          >
            {ride.notes}
          </div>
        )}
      </div>

      <DeleteRideButton id={ride.id} />
    </li>
  );
}
