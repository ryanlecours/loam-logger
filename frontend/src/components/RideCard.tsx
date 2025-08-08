interface RideCardProps {
  trail: string;
  date: string;
  distanceMiles: number;
  elevationFeet: number;
}

export default function RideCard({
  trail,
  date,
  distanceMiles,
  elevationFeet,
}: RideCardProps) {
  return (
    <div className="border rounded-md p-4 bg-gray-50 hover:bg-gray-100 transition">
      <div className="flex justify-between items-center">
        <h3 className="text-md font-semibold text-gray-800">{trail}</h3>
        <span className="text-sm text-gray-500">{date}</span>
      </div>
      <div className="flex gap-6 mt-2 text-sm text-gray-700">
        <span>{distanceMiles.toFixed(1)} miles</span>
        <span>{elevationFeet.toLocaleString()} ft climbed</span>
      </div>
    </div>
  );
}
