import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { FaWrench, FaCog, FaBicycle } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { getTopDueComponents } from '../../hooks/usePriorityBike';
import { COMPONENT_LABELS } from '../../constants/componentLabels';
import { MAX_DISPLAYED_COMPONENTS } from '../../constants/dashboard';
import { getBikeName } from '../../utils/formatters';
import { StatusPill } from './StatusPill';
import { ConfidenceTag } from './ConfidenceTag';
import { WhyToggle } from './WhyToggle';
import { MiniComponentList } from './MiniComponentList';
import { Button } from '../ui/Button';

interface PriorityBikeHeroProps {
  bike: BikeWithPredictions | null;
  isShowingPriority: boolean;
  onResetToPriority: () => void;
  isPro: boolean;
  onLogService: () => void;
  loading?: boolean;
  // Admin test ride props
  isAdmin?: boolean;
  isSimulatingRide?: boolean;
  onTestRide?: () => void;
  onLongRide?: () => void;
}

export function PriorityBikeHero({
  bike,
  isShowingPriority,
  onResetToPriority,
  isPro,
  onLogService,
  loading = false,
  isAdmin = false,
  isSimulatingRide = false,
  onTestRide,
  onLongRide,
}: PriorityBikeHeroProps) {
  // Loading skeleton
  if (loading) {
    return (
      <section className="priority-hero">
        <div className="priority-hero-header">
          <div className="skeleton" style={{ width: 80, height: 24, borderRadius: 12 }} />
          <div className="skeleton" style={{ width: 200, height: 28 }} />
        </div>
        <div className="priority-hero-content">
          <div className="skeleton" style={{ width: '60%', height: 24 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ width: '100%', height: 44 }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto' }}>
            <div className="skeleton" style={{ width: 120, height: 42 }} />
            <div className="skeleton" style={{ width: 140, height: 42 }} />
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
  const priorityComponent = predictions?.priorityComponent;
  const overallStatus = predictions?.overallStatus ?? 'ALL_GOOD';
  const topDueComponents = getTopDueComponents(predictions, MAX_DISPLAYED_COMPONENTS);
  const totalComponentCount = predictions?.components?.length ?? 0;
  const hasMoreComponents = totalComponentCount > MAX_DISPLAYED_COMPONENTS;
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
            {/* Key line */}
            {priorityComponent ? (
              <div className="priority-hero-keyline">
                <span className="priority-hero-next">
                  Next up: {COMPONENT_LABELS[priorityComponent.componentType] ?? priorityComponent.componentType}
                </span>
                <span className="priority-hero-hours">
                  {priorityComponent.hoursRemaining.toFixed(1)} hrs
                </span>
                <span className="priority-hero-rides">
                  ~{priorityComponent.ridesRemainingEstimate} rides
                </span>
                {isPro && priorityComponent.confidence && (
                  <ConfidenceTag level={priorityComponent.confidence} />
                )}
                {isPro && (
                  <WhyToggle
                    explanation={priorityComponent.why}
                    drivers={priorityComponent.drivers}
                  />
                )}
              </div>
            ) : (
              <div className="priority-hero-keyline">
                <span className="priority-hero-next" style={{ color: 'var(--mint)' }}>
                  All components healthy!
                </span>
              </div>
            )}

            {/* Mini component list */}
            <MiniComponentList components={topDueComponents} />
            {hasMoreComponents && (
              <Link to={`/gear/${bike.id}`} className="show-all-components-link">
                {totalComponentCount - MAX_DISPLAYED_COMPONENTS} more components...
              </Link>
            )}

            {/* Actions */}
            <div className="priority-hero-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={onLogService}
              >
                <FaWrench size={12} style={{ marginRight: '0.375rem' }} />
                Log service
              </Button>
              <Link to={`/gear/${bike.id}`}>
                <Button variant="secondary" size="sm">
                  <FaCog size={12} style={{ marginRight: '0.375rem' }} />
                  View maintenance
                </Button>
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Right column: bike image and admin buttons */}
        <div className="priority-hero-image-container">
          {bike.thumbnailUrl && (
            <img
              src={bike.thumbnailUrl}
              alt={bikeName}
              className="priority-hero-image"
            />
          )}
          {isAdmin && onTestRide && onLongRide && (
            <div className="priority-hero-admin-buttons">
              <button
                onClick={onTestRide}
                disabled={isSimulatingRide}
                className="priority-hero-admin-btn"
              >
                {isSimulatingRide ? 'Simulating...' : 'Test Ride'}
              </button>
              <button
                onClick={onLongRide}
                disabled={isSimulatingRide}
                className="priority-hero-admin-btn"
              >
                Long Ride
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
