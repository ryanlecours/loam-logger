import { usePreferences } from '../../hooks/usePreferences';

interface Props {
  distance: number; // meters
  elevation: number; // meters
  hours: number;
}

export default function StatsSummary({ distance, elevation, hours }: Props) {
  const { distanceUnit } = usePreferences();
  const displayDistance = distanceUnit === 'km'
    ? (distance / 1000).toFixed(1)
    : (distance / 1609.344).toFixed(1);
  const unitLabel = distanceUnit === 'km' ? 'km' : 'mi';
  const displayElevation = distanceUnit === 'km'
    ? Math.round(elevation).toLocaleString()
    : Math.round(elevation * 3.28084).toLocaleString();
  const elevLabel = distanceUnit === 'km' ? 'm' : 'ft';

  return (
    <div className="grid grid-cols-3 gap-4 text-center mb-6">
      <div><strong>{displayDistance} {unitLabel}</strong><div className="text-sm text-gray-500">Distance</div></div>
      <div><strong>{displayElevation} {elevLabel}</strong><div className="text-sm text-gray-500">Climbed</div></div>
      <div><strong>{hours} h</strong><div className="text-sm text-gray-500">Time</div></div>
    </div>
  );
}
