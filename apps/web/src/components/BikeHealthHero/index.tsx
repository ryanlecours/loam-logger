import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { BikeHealthCard } from './BikeHealthCard';
import { Button } from '../ui';
import type { BikeHealth } from '../../utils/transformToHealthData';

interface BikeHealthHeroProps {
  bikes: BikeHealth[];
  loading: boolean;
  error?: Error;
  firstName: string;
  onViewDetails: (bikeId: string) => void;
  onLogService: (bikeId: string) => void;
  onUploadGpx: () => void;
  devMode?: {
    onTestRide: () => void;
    onLongRide: () => void;
    isSimulating: boolean;
  };
}

export function BikeHealthHero({
  bikes,
  loading,
  error,
  firstName,
  onViewDetails,
  onLogService,
  onUploadGpx,
  devMode,
}: BikeHealthHeroProps) {
  return (
    <section className="bike-health-hero">
      {/* Header Row: Greeting + Quick Actions */}
      <div className="health-hero-header">
        <span className="hero-greeting-small">Hey {firstName}</span>
        <div className="hero-quick-actions">
          {devMode && (
            <>
              <button
                type="button"
                className="dev-btn"
                onClick={devMode.onTestRide}
                disabled={devMode.isSimulating}
              >
                {devMode.isSimulating ? 'Simulating...' : 'Test Ride'}
              </button>
              <button
                type="button"
                className="dev-btn"
                onClick={devMode.onLongRide}
                disabled={devMode.isSimulating}
              >
                {devMode.isSimulating ? 'Simulating...' : 'Long Ride'}
              </button>
            </>
          )}
          <Link to="/rides">
            <Button variant="primary">Log Ride</Button>
          </Link>
          <Button variant="secondary" onClick={onUploadGpx}>
            Upload GPX
          </Button>
        </div>
      </div>

      {/* Bike Cards Grid */}
      <div className="health-cards-grid">
        {loading && (
          <>
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={idx} className="health-card health-card-skeleton">
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-badge" />
                <div className="skeleton-line skeleton-buttons" />
              </div>
            ))}
          </>
        )}

        {error && (
          <motion.div
            className="health-error-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className="error-icon">⚠️</span>
            <p>Unable to load bikes: {error.message}</p>
          </motion.div>
        )}

        {!loading && !error && bikes.length === 0 && (
          <motion.div
            className="health-empty-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className="empty-icon">🚵</span>
            <p>
              No bikes in your garage yet.{' '}
              <Link to="/gear" className="empty-link">
                Add your first bike
              </Link>{' '}
              to start tracking components.
            </p>
          </motion.div>
        )}

        {!loading &&
          !error &&
          bikes.map((bike, idx) => (
            <motion.div
              key={bike.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
            >
              <BikeHealthCard
                bike={bike}
                onViewDetails={() => onViewDetails(bike.id)}
                onLogService={() => onLogService(bike.id)}
              />
            </motion.div>
          ))}
      </div>
    </section>
  );
}

export { BikeHealthCard } from './BikeHealthCard';
