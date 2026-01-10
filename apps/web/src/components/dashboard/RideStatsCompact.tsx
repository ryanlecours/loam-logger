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
                <div className="skeleton skeleton-text-lg mb-1" />
                <div className="skeleton skeleton-text-sm" />
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
          <Link to="/rides" className="link-subtle">
            <FaChartLine size={12} />
            View details
          </Link>
        </div>
      </div>
    </section>
  );
}
