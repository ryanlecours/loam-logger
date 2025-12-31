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
            <div key={i} style={{ padding: '0.75rem 1.25rem' }}>
              <div className="skeleton" style={{ width: '70%', height: 16, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '50%', height: 14 }} />
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
            No rides yet. <Link to="/rides" style={{ color: 'var(--mint)' }}>Log your first ride</Link>
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
      <div className="recent-rides-scroll">
        {rides.map((ride) => (
          <CompactRideRow key={ride.id} ride={ride} />
        ))}
      </div>
    </section>
  );
}
