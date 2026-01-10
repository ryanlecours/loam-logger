import { Link } from 'react-router-dom';
import { FaRoute } from 'react-icons/fa';
import { CompactRideRow } from './CompactRideRow';

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

interface RecentRidesCardProps {
  rides: Ride[];
  loading?: boolean;
}

export function RecentRidesCard({ rides, loading = false }: RecentRidesCardProps) {
  // Loading skeleton
  if (loading) {
    return (
      <section className="recent-rides-card">
        <div className="recent-rides-header">
          <h3 className="recent-rides-title">Recent Rides</h3>
        </div>
        <div className="recent-rides-scroll">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-5 py-3">
              <div className="skeleton w-3/4 h-4 mb-2" />
              <div className="skeleton w-1/2 h-3.5" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Empty state
  if (rides.length === 0) {
    return (
      <section className="recent-rides-card">
        <div className="recent-rides-header">
          <h3 className="recent-rides-title">Recent Rides</h3>
          <Link to="/rides" className="recent-rides-link">
            View all
          </Link>
        </div>
        <div className="recent-rides-empty">
          <FaRoute className="recent-rides-empty-icon" />
          <p className="recent-rides-empty-text">
            No rides yet. <Link to="/rides" className="text-mint hover:underline">Log your first ride</Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="recent-rides-card">
      <div className="recent-rides-header">
        <h3 className="recent-rides-title">Recent Rides</h3>
        <Link to="/rides" className="recent-rides-link">
          View all
        </Link>
      </div>
      <div className="recent-rides-scroll list-stagger">
        {rides.map((ride) => (
          <CompactRideRow key={ride.id} ride={ride} />
        ))}
      </div>
    </section>
  );
}
