import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FaChartLine } from 'react-icons/fa';
import {
  getTimeframeStartDate,
  filterRidesByDate,
  calculateRideStats,
  type Timeframe,
} from '../../utils/rideStats';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
}

interface RideStatsCompactProps {
  rides: Ride[];
  loading?: boolean;
}

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  'YTD': 'Year to date',
};

export function RideStatsCompact({ rides, loading = false }: RideStatsCompactProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30');

  const stats = useMemo(() => {
    const startDate = getTimeframeStartDate(timeframe);
    const filteredRides = filterRidesByDate(rides, startDate);
    return calculateRideStats(filteredRides);
  }, [rides, timeframe]);

  // Loading skeleton
  if (loading) {
    return (
      <section className="ride-stats-compact">
        <div className="ride-stats-compact-header">
          <h3 className="ride-stats-compact-title">Ride Stats</h3>
        </div>
        <div className="ride-stats-compact-content">
          <div className="ride-stats-compact-metrics">
            {[1, 2, 3].map((i) => (
              <div key={i} className="ride-stats-compact-metric">
                <div className="skeleton" style={{ width: 48, height: 28, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: 40, height: 12 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ride-stats-compact">
      <div className="ride-stats-compact-header">
        <h3 className="ride-stats-compact-title">Ride Stats</h3>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          className="timeframe-select"
          style={{
            background: 'rgba(54, 60, 57, 0.5)',
            border: '1px solid rgba(134, 158, 140, 0.2)',
            borderRadius: 6,
            padding: '0.25rem 0.5rem',
            color: 'var(--cream)',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
            <option key={tf} value={tf}>
              {TIMEFRAME_LABELS[tf]}
            </option>
          ))}
        </select>
      </div>
      <div className="ride-stats-compact-content">
        <div className="ride-stats-compact-metrics">
          <div className="ride-stats-compact-metric">
            <span className="ride-stats-compact-value">{stats.hours}</span>
            <span className="ride-stats-compact-label">Hours</span>
          </div>
          <div className="ride-stats-compact-metric">
            <span className="ride-stats-compact-value">{stats.miles}</span>
            <span className="ride-stats-compact-label">Miles</span>
          </div>
          <div className="ride-stats-compact-metric">
            <span className="ride-stats-compact-value">{stats.climb}</span>
            <span className="ride-stats-compact-label">Climb (ft)</span>
          </div>
        </div>
        <div className="ride-stats-compact-footer">
          <Link
            to="/rides"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              fontSize: '0.75rem',
              color: 'var(--sage)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--mint)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sage)')}
          >
            <FaChartLine size={12} />
            View details
          </Link>
        </div>
      </div>
    </section>
  );
}
