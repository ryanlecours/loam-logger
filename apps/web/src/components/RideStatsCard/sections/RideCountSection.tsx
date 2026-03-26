import type { RideCountStats } from '../types';
import { usePreferences } from '../../../hooks/usePreferences';

interface RideCountSectionProps {
  stats: RideCountStats;
}

export default function RideCountSection({ stats }: RideCountSectionProps) {
  const { distanceUnit } = usePreferences();
  const avgDistance = distanceUnit === 'km'
    ? (stats.avgDistancePerRide / 1000).toFixed(1)
    : (stats.avgDistancePerRide / 1609.344).toFixed(1);

  return (
    <div className="stats-grid-2x2">
      <div className="stat-cell">
        <span className="stat-value">{stats.totalRides}</span>
        <span className="stat-label">Total Rides</span>
      </div>
      <div className="stat-cell">
        <span className="stat-value">{avgDistance} {distanceUnit}</span>
        <span className="stat-label">Avg Distance</span>
      </div>
      <div className="stat-cell">
        <span className="stat-value">
          {distanceUnit === 'km'
            ? `${Math.round(stats.avgElevationPerRide).toLocaleString()} m`
            : `${Math.round(stats.avgElevationPerRide * 3.28084).toLocaleString()} ft`}
        </span>
        <span className="stat-label">Avg Elevation</span>
      </div>
      <div className="stat-cell">
        <span className="stat-value">{stats.avgDurationMinutes} min</span>
        <span className="stat-label">Avg Duration</span>
      </div>
    </div>
  );
}
