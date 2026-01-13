import { FaHeartbeat } from 'react-icons/fa';
import type { HeartRateStats } from '../types';

interface HeartRateSectionProps {
  stats: HeartRateStats;
}

export default function HeartRateSection({ stats }: HeartRateSectionProps) {
  return (
    <div className="hr-content">
      <div className="hr-stats-row">
        <div className="hr-stat">
          <FaHeartbeat className="hr-icon" />
          <span className="hr-value">{stats.averageHr ?? '—'}</span>
          <span className="hr-label">Avg BPM</span>
        </div>
        <div className="hr-stat">
          <span className="hr-value hr-max">{stats.maxHr ?? '—'}</span>
          <span className="hr-label">Peak Avg</span>
        </div>
      </div>

      <div className="hr-coverage">
        <span className="hr-coverage-text">
          {stats.ridesWithHr} of {stats.totalRides} rides have heart rate data
        </span>
        <div className="hr-coverage-bar">
          <div
            className="hr-coverage-fill"
            style={{
              width: `${stats.totalRides > 0 ? (stats.ridesWithHr / stats.totalRides) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
