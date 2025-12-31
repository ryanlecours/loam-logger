import { format, isValid } from 'date-fns';

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

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatRideDate(startTime: string | undefined | null): string {
  if (!startTime) return 'Unknown';
  const date = new Date(startTime);
  if (!isValid(date)) return 'Unknown';
  return format(date, 'MMM d');
}

function getRideSource(
  ride: Ride
): 'strava' | 'garmin' | 'manual' {
  if (ride.stravaActivityId) return 'strava';
  if (ride.garminActivityId) return 'garmin';
  return 'manual';
}

const SOURCE_LABELS: Record<string, string> = {
  strava: 'Strava',
  garmin: 'Garmin',
  manual: 'Manual',
};

export function CompactRideRow({ ride }: CompactRideRowProps) {
  const title = ride.trailSystem || ride.location || 'Ride';
  const formattedDate = formatRideDate(ride.startTime);
  const duration = formatDuration(ride.durationSeconds);
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
