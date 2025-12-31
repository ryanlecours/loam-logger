import { formatDurationCompact, formatRideDate } from '../../utils/formatters';
import { getRideSource, SOURCE_LABELS } from '../../utils/rideSource';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  trailSystem?: string | null;
  location?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

interface CompactRideRowProps {
  ride: Ride;
}

export function CompactRideRow({ ride }: CompactRideRowProps) {
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
      </div>
      <div className="compact-ride-source">
        <span className={`source-badge source-badge-${source}`}>
          {SOURCE_LABELS[source]}
        </span>
      </div>
    </div>
  );
}
