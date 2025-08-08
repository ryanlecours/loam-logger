import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-200 to-gray-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">LoamLogger</h1>
        <p className="text-lg text-gray-600 mb-8">
          Track your mountain bike rides, monitor your gear, and log your time in the loam.
        </p>
        <Link
          to="/login"
          className="inline-block bg-black text-white px-6 py-3 rounded-md text-lg font-semibold hover:bg-gray-800 transition"
        >
          Log In
        </Link>
      </div>
    </div>
  );
}