import { useState } from 'react';
import TimeframeSelector from './TimeframeSelector';
import StatsSummary from './StatsSummary';
import BikeUsageChart from './BikeUsageChart';
import { mockRideStats } from '../../mockData/mockRideStats';


export default function RideStatsCard() {
  const [selectedTf, setSelectedTf] = useState<'1w' | '1m' | '3m' | 'YTD'>('1w');
  const data = mockRideStats[selectedTf];

  return (
    <div className="border p-6 rounded shadow bg-white w-full">
      <h2 className="text-xl font-bold mb-2">Ride Stats</h2>
      <TimeframeSelector selected={selectedTf} onSelect={setSelectedTf} />
      <StatsSummary {...data} />
      <BikeUsageChart data={data.bikeTime} />
    </div>
  );
}
