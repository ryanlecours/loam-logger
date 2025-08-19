// src/pages/Rides.tsx
import { useQuery } from "@apollo/client";
import AddRideForm from "../components/AddRideForm";
import RideCard from "../components/RideCard";
import { RIDES } from '../graphql/rides';

type Ride = {
  id: string;
  startTime: string | number;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
};

export default function RidesPage() {
  const { data, refetch } = useQuery(RIDES);
  return (
    <div className="grid gap-6 max-w-3xl mx-auto p-4">
      <AddRideForm onAdded={() => refetch()} />
      <ul className="grid gap-2">
        {data?.rides?.map((ride: Ride) => (
          <RideCard key={ride.id} ride={ride} />
        ))}
      </ul>
    </div>
  );
}
