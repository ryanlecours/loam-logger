import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { FaWrench, FaCog, FaBicycle } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { getBikeName } from '../../utils/formatters';
import { StatusPill } from './StatusPill';
import { ComponentHealthPanel } from './ComponentHealthPanel';
import { CompactRideRow } from './CompactRideRow';
import { Button } from '../ui/Button';

interface BikeRide {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  trailSystem?: string | null;
  location?: string | null;
  bikeId?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

interface PriorityBikeHeroProps {
  bike: BikeWithPredictions | null;
  isShowingPriority: boolean;
  onResetToPriority: () => void;
  onLogService: () => void;
  loading?: boolean;
  rides?: BikeRide[];
}

export function PriorityBikeHero({
  bike,
  isShowingPriority,
  onResetToPriority,
  onLogService,
  loading = false,
  rides = [],
}: PriorityBikeHeroProps) {
  // Loading skeleton
  if (loading) {
    return (
      <section className="priority-hero">
        <div className="priority-hero-header">
          <div className="skeleton skeleton-pill" />
          <div className="skeleton skeleton-title" />
        </div>
        <div className="priority-hero-content">
          <div className="skeleton w-60 h-6" />
          <div className="skeleton-column">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
          <div className="skeleton-row-group">
            <div className="skeleton skeleton-btn" />
            <div className="skeleton skeleton-btn-lg" />
          </div>
        </div>
      </section>
    );
  }

  // Empty state
  if (!bike) {
    return (
      <section className="priority-hero">
        <div className="priority-hero-empty">
          <FaBicycle size={48} className="priority-hero-empty-icon" />
          <div>
            <h2 className="priority-hero-empty-title">No bikes yet</h2>
            <p className="priority-hero-empty-text">
              Add your first bike to start tracking maintenance
            </p>
          </div>
          <Link to="/gear">
            <Button variant="primary">Add a Bike</Button>
          </Link>
        </div>
      </section>
    );
  }

  const predictions = bike.predictions;
  const overallStatus = predictions?.overallStatus ?? 'ALL_GOOD';
  const components = predictions?.components ?? [];
  const bikeName = getBikeName(bike);

  return (
    <section className="priority-hero">
      {/* Header */}
      <div className="priority-hero-header">
        <StatusPill status={overallStatus} />
        <AnimatePresence mode="wait">
          <motion.h2
            key={bike.id}
            className="priority-hero-title"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
          >
            {bikeName}
          </motion.h2>
        </AnimatePresence>
        {!isShowingPriority && (
          <button
            className="priority-hero-back"
            onClick={onResetToPriority}
          >
            ← Back to priority
          </button>
        )}
      </div>

      {/* Two-column layout: components left, bike image right */}
      <div className="priority-hero-body">
        {/* Left column: components and actions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={bike.id}
            className="priority-hero-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Component Health Panel */}
            <ComponentHealthPanel components={components} />

            {/* Actions */}
            <div className="priority-hero-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={onLogService}
              >
                <FaWrench size={12} className="icon-left" />
                Log service
              </Button>
              <Link to={`/gear/${bike.id}`}>
                <Button variant="secondary" size="sm">
                  <FaCog size={12} className="icon-left" />
                  View maintenance
                </Button>
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Right column: bike image and recent rides */}
        <div className="priority-hero-image-container">
          {bike.thumbnailUrl && (
            <img
              src={bike.thumbnailUrl}
              alt={bikeName}
              className="priority-hero-image"
            />
          )}
          {/* Bike Rides Section - desktop only */}
          {(() => {
            const bikeRides = rides.filter((r) => r.bikeId === bike.id);
            return (
              <div className="priority-hero-bike-rides">
                <h4 className="priority-hero-bike-rides-header">Recent Rides</h4>
                {bikeRides.length > 0 ? (
                  <div className="priority-hero-bike-rides-list">
                    {bikeRides.map((ride) => (
                      <CompactRideRow
                        key={ride.id}
                        ride={ride}
                        bikeName={bikeName}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="priority-hero-bike-rides-empty">No rides on this bike yet</p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
}
