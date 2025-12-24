import { FaArrowUp, FaArrowDown, FaMinus, FaFire, FaTrophy } from 'react-icons/fa';
import type { TrendStats } from '../types';

interface TrendsSectionProps {
  stats: TrendStats;
}

function TrendIndicator({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <div className="trend-item">
        <span className="trend-icon trend-neutral">
          <FaMinus size={10} />
        </span>
        <span className="trend-label">{label}</span>
        <span className="trend-value trend-neutral">—</span>
      </div>
    );
  }

  const isPositive = value > 0;
  const isNeutral = value === 0;

  return (
    <div className="trend-item">
      <span className={`trend-icon ${isPositive ? 'trend-up' : isNeutral ? 'trend-neutral' : 'trend-down'}`}>
        {isPositive ? <FaArrowUp size={10} /> : isNeutral ? <FaMinus size={10} /> : <FaArrowDown size={10} />}
      </span>
      <span className="trend-label">{label}</span>
      <span className={`trend-value ${isPositive ? 'trend-up' : isNeutral ? 'trend-neutral' : 'trend-down'}`}>
        {isPositive ? '+' : ''}{value}%
      </span>
    </div>
  );
}

function formatRecordValue(type: string, value: number): string {
  switch (type) {
    case 'longest_ride':
      return `${value.toFixed(1)} mi`;
    case 'most_elevation':
      return `${value.toLocaleString()} ft`;
    case 'longest_duration': {
      const hours = Math.floor(value / 3600);
      const mins = Math.round((value % 3600) / 60);
      return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    default:
      return String(value);
  }
}

function getRecordLabel(type: string): string {
  switch (type) {
    case 'longest_ride':
      return 'Longest Ride';
    case 'most_elevation':
      return 'Most Climbing';
    case 'longest_duration':
      return 'Longest Duration';
    default:
      return type;
  }
}

export default function TrendsSection({ stats }: TrendsSectionProps) {
  return (
    <div className="trends-content">
      {/* Week over week trends */}
      <div className="trends-row">
        <TrendIndicator value={stats.weekOverWeekDistance} label="Distance vs last week" />
        <TrendIndicator value={stats.weekOverWeekRides} label="Rides vs last week" />
      </div>

      {/* Streaks */}
      <div className="streaks-row">
        <div className="streak-item">
          <FaFire className="streak-icon" />
          <div className="streak-info">
            <span className="streak-value">{stats.currentStreak}</span>
            <span className="streak-label">Current Streak</span>
          </div>
        </div>
        <div className="streak-item">
          <FaTrophy className="streak-icon streak-icon-gold" />
          <div className="streak-info">
            <span className="streak-value">{stats.longestStreak}</span>
            <span className="streak-label">Longest Streak</span>
          </div>
        </div>
      </div>

      {/* Personal Records */}
      {stats.personalRecords.length > 0 && (
        <div className="records-list">
          <h4 className="records-title">Personal Records</h4>
          {stats.personalRecords.map((record) => (
            <div key={record.type} className="record-item">
              <span className="record-label">{getRecordLabel(record.type)}</span>
              <span className="record-value">{formatRecordValue(record.type, record.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
