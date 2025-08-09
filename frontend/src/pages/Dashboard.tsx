import { Link } from "react-router-dom";
import { mockRides } from "../mockData/rides";
import { bikes } from "../mockData/garage";
import BikeCard from "../components/BikeCard";
import RideStatsCard from "../components/RideStatsCard.tsx";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-app p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">
          LoamLogger Dashboard
        </h1>
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Log out
        </Link>
      </header>

      {/* Welcome */}
      <section className="mb-6">
        <p className="text-lg text-accent-contrast">
          Welcome back! Here's a quick look at your mountain biking activity and
          gear status.
        </p>
      </section>

      {/* Placeholder Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Ride Summary */}
        <div className="bg-surface border rounded-md shadow p-4">
          <h2 className="text-xl font-semibold mb-2">Recent Rides</h2>
          <div className="space-y-4">
            {mockRides.map((ride) => (
              <div
                key={ride.id}
                className="border rounded-md p-4 bg-gray-50 hover:bg-gray-100 transition"
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-md font-semibold text-gray-800">
                    {ride.trail}
                  </h3>
                  <span className="text-sm text-gray-500">{ride.date}</span>
                </div>
                <div className="flex gap-6 mt-2 text-sm text-gray-700">
                  <span>{ride.distanceMiles.toFixed(1)} miles</span>
                  <span>{ride.elevationFeet.toLocaleString()} ft climbed</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        { /* Ride Stats */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
      <RideStatsCard />
      {/* Other dashboard components like BikeCards, RideCards, etc. */}
    </div>
        {/* Gear Summary */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
          <h2 className="text-xl font-semibold mb-2">Bike / Gear Tracker</h2>
          <div className="p-4 space-y-6">
      {bikes.map(bike => (
        <BikeCard key={bike.id} bike={bike} />
      ))}
    </div>
        </div>
      </section>
    </div>
  );
}
