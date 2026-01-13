import { formatDurationCompact, formatRideDate } from '../../utils/formatters';
import { getRideSource, SOURCE_LABELS } from '../../utils/rideSource';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  rideType?: string;
  trailSystem?: string | null;
  location?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  bikeId?: string | null;
}

interface CompactRideRowProps {
  ride: Ride;
  bikeName?: string | null;
  onLinkBike?: (ride: Ride) => void;
}

export function CompactRideRow({ ride, bikeName, onLinkBike }: CompactRideRowProps) {
  const title = ride.trailSystem || ride.location || 'Ride';
  const formattedDate = formatRideDate(ride.startTime);
  const duration = formatDurationCompact(ride.durationSeconds);
  const climbValue = ride.elevationGainFeet ?? 0;
  const climb = isNaN(climbValue) ? '0' : Math.round(climbValue).toLocaleString();
  const source = getRideSource(ride);

  return (
    <div className="compact-ride-row">
      <div className="compact-ride-content">
        <h4 className="compact-ride-title" title={title}>
          {title}
        </h4>
        <div className="compact-ride-meta">
          <span>{formattedDate}</span>
          <span className="compact-ride-meta-sep">•</span>
          <span>{duration}</span>
          <span className="compact-ride-meta-sep">•</span>
          <span>{climb} ft</span>
        </div>
        {bikeName ? (
          <div className="compact-ride-bike">
            {bikeName}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onLinkBike?.(ride)}
            className="compact-ride-no-bike"
          >
            Link bike
          </button>
        )}
      </div>
      <div className="compact-ride-source">
        <span className={`source-badge source-badge-${source}`}>
          {SOURCE_LABELS[source]}
        </span>
      </div>
    </div>
  );
}
