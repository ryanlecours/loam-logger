import { FaMapMarkerAlt, FaMountain } from 'react-icons/fa';
import type { LocationStats, LocationBreakdown } from '../types';

interface LocationSectionProps {
  stats: LocationStats;
}

function LocationList({
  items,
  icon,
  title,
}: {
  items: LocationBreakdown[];
  icon: React.ReactNode;
  title: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="location-group">
      <div className="location-group-header">
        {icon}
        <span className="location-group-title">{title}</span>
      </div>
      <div className="location-list">
        {items.map((item) => (
          <div key={item.name} className="location-item">
            <span className="location-name">{item.name}</span>
            <span className="location-stats">
              <span className="location-rides">{item.rideCount} rides</span>
              <span className="location-pct">{item.percentage}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LocationSection({ stats }: LocationSectionProps) {
  const hasLocations = stats.topLocations.length > 0;
  const hasTrailSystems = stats.topTrailSystems.length > 0;

  return (
    <div className="locations-content">
      {hasLocations && (
        <LocationList
          items={stats.topLocations}
          icon={<FaMapMarkerAlt className="location-icon" />}
          title="Top Locations"
        />
      )}

      {hasTrailSystems && (
        <LocationList
          items={stats.topTrailSystems}
          icon={<FaMountain className="location-icon" />}
          title="Trail Systems"
        />
      )}

      {!hasLocations && !hasTrailSystems && (
        <p className="section-empty">No location data available</p>
      )}
    </div>
  );
}
