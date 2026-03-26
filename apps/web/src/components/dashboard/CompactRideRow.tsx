import { useState } from 'react';
import { formatDurationCompact, formatRideDate } from '../../utils/formatters';
import { getRideSource, SOURCE_LABELS } from '../../utils/rideSource';
import { usePreferences } from '../../hooks/usePreferences';
import EditRideModal from '../EditRideModal';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  averageHr?: number | null;
  rideType: string;
  trailSystem?: string | null;
  location?: string | null;
  notes?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  whoopWorkoutId?: string | null;
  bikeId?: string | null;
}

interface CompactRideRowProps {
  ride: Ride;
  bikeName?: string | null;
  onLinkBike?: (ride: Ride) => void;
}

export function CompactRideRow({ ride, bikeName, onLinkBike }: CompactRideRowProps) {
  const [editing, setEditing] = useState(false);
  const { distanceUnit } = usePreferences();
  const title = ride.trailSystem || ride.location || 'Ride';
  const formattedDate = formatRideDate(ride.startTime);
  const duration = formatDurationCompact(ride.durationSeconds);
  const climbMeters = ride.elevationGainMeters ?? 0;
  const climbValue = distanceUnit === 'km' ? climbMeters : climbMeters * 3.28084;
  const climb = isNaN(climbValue) ? '0' : Math.round(climbValue).toLocaleString();
  const climbUnit = distanceUnit === 'km' ? 'm' : 'ft';
  const source = getRideSource(ride);

  return (
    <>
      <div
        className="compact-ride-row cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
      >
        <div className="compact-ride-content">
          <h4 className="compact-ride-title" title={title}>
            {title}
          </h4>
          <div className="compact-ride-meta">
            <span>{formattedDate}</span>
            <span className="compact-ride-meta-sep">&bull;</span>
            <span>{duration}</span>
            <span className="compact-ride-meta-sep">&bull;</span>
            <span>{climb} {climbUnit}</span>
          </div>
          {bikeName ? (
            <div className="compact-ride-bike">
              {bikeName}
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onLinkBike?.(ride); }}
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

      {editing && <EditRideModal ride={ride} onClose={() => setEditing(false)} />}
    </>
  );
}
