import type { BikeTimeData } from '../types';

interface BikeUsageSectionProps {
  data: BikeTimeData[];
}

export default function BikeUsageSection({ data }: BikeUsageSectionProps) {
  return (
    <div className="bike-usage-list">
      {data.map((bike) => (
        <div key={bike.name} className="bike-usage-item">
          <span className="bike-usage-name">{bike.name}</span>
          <span className="bike-usage-stats">
            <span className="bike-usage-hours">{bike.hours}h</span>
            <span className="bike-usage-pct">{bike.percentage}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}
