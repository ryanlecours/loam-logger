import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="bg-loam-gradient min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4">LoamLogger</h1>
        <p className="text-l mb-8">
          Track your mountain bike rides, monitor your gear, and log your time in the loam.
        </p>
        <Link
          to="/login"
          className="btn-primary"
        >
          Log In
        </Link>
      </div>
    </div>
  );
}