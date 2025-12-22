interface Props {
  distance: number; // miles
  elevation: number; // ft
  hours: number;
}

export default function StatsSummary({ distance, elevation, hours }: Props) {
  return (
    <div className="grid grid-cols-3 gap-4 text-center mb-6">
      <div><strong>{distance.toFixed(1)} mi</strong><div className="text-sm text-gray-500">Distance</div></div>
      <div><strong>{elevation.toLocaleString()} ft</strong><div className="text-sm text-gray-500">Climbed</div></div>
      <div><strong>{hours} h</strong><div className="text-sm text-gray-500">Time</div></div>
    </div>
  );
}
