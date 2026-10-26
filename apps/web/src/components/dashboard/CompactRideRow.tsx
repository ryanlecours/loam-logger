import { useState } from 'react';
import { formatDurationCompact, formatRideDate } from '../../utils/formatters';
import RideSourceBadges from '../RideSourceBadges';
import { usePreferences } from '../../hooks/usePreferences';
import EditRideModal from '../EditRideModal';
import WeatherBadge from '../WeatherBadge';
import type { RideWeather } from '../../models/Ride';
import { rideClimbMeters, type RideLiftSummary } from '../../lib/rideLift';
import LiftTag from '../LiftTag';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  countedElevationGainMeters?: number | null;
  lift?: RideLiftSummary | null;
  elevationLossMeters?: number | null;
  averageHr?: number | null;
  rideType: string;
  trailSystem?: string | null;
  location?: string | null;
  notes?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  garminDeviceName?: string | null;
  whoopWorkoutId?: string | null;
  bikeId?: string | null;
  weather?: RideWeather | null;
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
  const climbMeters = rideClimbMeters(ride);
  const climbValue = distanceUnit === 'km' ? climbMeters : climbMeters * 3.28084;
  const climb = isNaN(climbValue) ? '0' : Math.round(climbValue).toLocaleString();
  const climbUnit = distanceUnit === 'km' ? 'm' : 'ft';
  // Null means no source reported a descent, so the row shows the climb alone
  // rather than a 0 that would read as a flat ride.
  const descentMeters = ride.elevationLossMeters;
  const descent =
    descentMeters == null
      ? null
      : Math.round(distanceUnit === 'km' ? descentMeters : descentMeters * 3.28084).toLocaleString();

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
            <span>
              {descent == null ? `${climb} ${climbUnit}` : `↑ ${climb} ↓ ${descent} ${climbUnit}`}
            </span>
            {ride.lift && (
              <>
                <span className="compact-ride-meta-sep">&bull;</span>
                <LiftTag lift={ride.lift} />
              </>
            )}
            {ride.weather && (
              <>
                <span className="compact-ride-meta-sep">&bull;</span>
                <WeatherBadge weather={ride.weather} distanceUnit={distanceUnit} />
              </>
            )}
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
          <RideSourceBadges ride={ride} />
        </div>
      </div>

      {editing && <EditRideModal ride={ride} onClose={() => setEditing(false)} />}
    </>
  );
}
