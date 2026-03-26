import { usePreferences } from '../../hooks/usePreferences';

interface Props {
  distance: number; // miles
  elevation: number; // ft
  hours: number;
}

export default function StatsSummary({ distance, elevation, hours }: Props) {
  const { distanceUnit } = usePreferences();
  const displayDistance = distanceUnit === 'km' ? (distance * 1.60934).toFixed(1) : distance.toFixed(1);
  const unitLabel = distanceUnit === 'km' ? 'km' : 'mi';

  return (
    <div className="grid grid-cols-3 gap-4 text-center mb-6">
      <div><strong>{displayDistance} {unitLabel}</strong><div className="text-sm text-gray-500">Distance</div></div>
      <div><strong>{elevation.toLocaleString()} ft</strong><div className="text-sm text-gray-500">Climbed</div></div>
      <div><strong>{hours} h</strong><div className="text-sm text-gray-500">Time</div></div>
    </div>
  );
}
