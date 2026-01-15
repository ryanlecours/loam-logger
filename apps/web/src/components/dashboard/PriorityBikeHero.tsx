import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { FaWrench, FaCog, FaBicycle, FaChevronUp, FaChevronDown, FaStrava } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { useBikeRides, type BikeRide } from '../../hooks/useBikeRides';
import { getBikeName } from '../../utils/formatters';
import { StatusPill } from './StatusPill';
import { ComponentHealthPanel } from './ComponentHealthPanel';
import { CompactRideRow } from './CompactRideRow';
import { Button } from '../ui/Button';

interface PriorityBikeHeroProps {
  bike: BikeWithPredictions | null;
  isShowingPriority: boolean;
  onResetToPriority: () => void;
  onLogService: () => void;
  onStravaBackfill?: () => void;
  isStravaConnected?: boolean;
  loading?: boolean;
  rides?: BikeRide[];
}

export function PriorityBikeHero({
  bike,
  isShowingPriority,
  onResetToPriority,
  onLogService,
  onStravaBackfill,
  isStravaConnected = false,
  loading = false,
  rides = [],
}: PriorityBikeHeroProps) {
  // Paginated rides for this bike - show 5 rides in hero
  const {
    rides: paginatedRides,
    canGoNewer,
    canGoOlder,
    goNewer,
    goOlder,
    loading: ridesLoading,
    pageIndex,
    rangeInfo,
  } = useBikeRides(bike?.id ?? null, rides, 5);

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
      {/* Constrained width container for header and columns */}
      <div className="priority-hero-body">
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

        {/* Two-column layout: components | bike image + recent rides */}
        <div className="priority-hero-columns">
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
              <span title="Coming soon - available by January 21, 2026">
                <Button variant="secondary" size="sm" disabled>
                  <FaCog size={12} className="icon-left" />
                  View maintenance
                </Button>
              </span>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Right column: bike image stacked on top of recent rides */}
        <div className="priority-hero-right-column">
          {/* Bike image */}
          <div className="priority-hero-image-container">
            {bike.thumbnailUrl && (
              <img
                src={bike.thumbnailUrl}
                alt={bikeName}
                className="priority-hero-image"
              />
            )}
          </div>

          {/* Recent rides */}
          <div className="priority-hero-bike-rides">
          <h4 className="priority-hero-bike-rides-header">Recent Rides</h4>
          {paginatedRides.length > 0 ? (
            <div className="priority-hero-bike-rides-list">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`rides-page-${pageIndex}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {paginatedRides.map((ride) => (
                    <CompactRideRow
                      key={ride.id}
                      ride={ride}
                      bikeName={bikeName}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="priority-hero-bike-rides-empty">
              <p>No rides on this bike yet</p>
              <div className="priority-hero-bike-rides-cta">
                <Link to="/rides" className="empty-cta-link">
                  Log a ride
                </Link>
                <span className="empty-cta-divider">or</span>
                <button
                  type="button"
                  className="empty-cta-link empty-cta-strava"
                  onClick={onStravaBackfill}
                >
                  <FaStrava size={14} />
                  {isStravaConnected ? 'Backfill from Strava' : 'Connect Strava'}
                </button>
              </div>
            </div>
          )}
          {/* Navigation arrows below rides */}
          {(canGoNewer || canGoOlder) && (
            <div className="bike-rides-nav">
              <div className="bike-rides-nav-buttons">
                <button
                  type="button"
                  className="bike-rides-nav-btn"
                  onClick={goNewer}
                  disabled={!canGoNewer}
                  aria-label="Show newer rides"
                >
                  <FaChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="bike-rides-nav-btn"
                  onClick={goOlder}
                  disabled={!canGoOlder || ridesLoading}
                  aria-label="Show older rides"
                >
                  <FaChevronDown size={14} />
                </button>
              </div>
              <span className="bike-rides-nav-range">
                {rangeInfo.start}–{rangeInfo.end} of {rangeInfo.total}{rangeInfo.hasMore ? '+' : ''}
              </span>
            </div>
          )}
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
