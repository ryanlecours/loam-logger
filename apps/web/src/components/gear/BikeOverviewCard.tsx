import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { FaBicycle, FaWrench, FaEye, FaPencilAlt, FaTrash, FaExternalLinkAlt } from 'react-icons/fa';
import { Button } from '../ui/Button';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';
import { StatusDot } from '../dashboard/StatusDot';
import type { PredictionStatus, BikePredictionSummary } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';

type ComponentDto = {
  id: string;
  type: string;
  brand: string;
  model: string;
  notes?: string | null;
  isStock: boolean;
  bikeId?: string | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type BikeDto = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  year?: number | null;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  notes?: string | null;
  spokesId?: string | null;
  spokesUrl?: string | null;
  thumbnailUrl?: string | null;
  family?: string | null;
  category?: string | null;
  subcategory?: string | null;
  buildKind?: string | null;
  isFrameset?: boolean | null;
  isEbike?: boolean | null;
  gender?: string | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
  components: ComponentDto[];
  predictions?: BikePredictionSummary | null;
};

interface BikeOverviewCardProps {
  bike: BikeDto;
  onEdit: () => void;
  onDelete: () => void;
  onLogService?: () => void;
  isDeleting?: boolean;
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '—';
  const safeHours = Math.max(0, hours);
  return `${safeHours.toFixed(1)}h`;
}

export function BikeOverviewCard({
  bike,
  onEdit,
  onDelete,
  onLogService,
  isDeleting: _isDeleting = false,
}: BikeOverviewCardProps) {
  const predictions = bike.predictions;
  const components = predictions?.components ?? [];

  // Sort components by urgency (most urgent first)
  const sortedComponents = [...components].sort((a, b) => {
    const statusOrder: Record<PredictionStatus, number> = {
      OVERDUE: 0,
      DUE_NOW: 1,
      DUE_SOON: 2,
      ALL_GOOD: 3,
    };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.hoursRemaining - b.hoursRemaining;
  });

  const menuItems: KebabMenuItem[] = [
    {
      label: 'Edit bike',
      icon: <FaPencilAlt size={12} />,
      onClick: onEdit,
    },
    {
      label: 'Delete bike',
      icon: <FaTrash size={12} />,
      onClick: onDelete,
      danger: true,
    },
  ];

  const bikeName = bike.year ? `${bike.year} ${bike.model}` : bike.model;

  return (
    <motion.article
      className="bike-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      layout
    >
      {/* Header */}
      <header className="bike-card-header">
        <div className="bike-card-header-content">
          <p className="bike-card-manufacturer">{bike.manufacturer}</p>
          <h3 className="bike-card-name">{bikeName}</h3>
          {bike.nickname && (
            <p className="bike-card-nickname">"{bike.nickname}"</p>
          )}

          {/* Badges */}
          <div className="bike-card-badges">
            {bike.category && (
              <span className="bike-card-badge">
                {bike.subcategory || bike.category}
              </span>
            )}
            {bike.isEbike && (
              <span className="bike-card-badge bike-card-badge-accent">
                E-Bike
              </span>
            )}
            {bike.frameMaterial && (
              <span className="bike-card-badge">{bike.frameMaterial}</span>
            )}
          </div>
        </div>

        <KebabMenu items={menuItems} ariaLabel={`Actions for ${bikeName}`} />
      </header>

      {/* Body - Two Column Layout */}
      <div className="bike-card-body">
        {/* Left column: stats, health, actions */}
        <div className="bike-card-content">
          {/* Stats Row */}
          <div className="bike-card-stats">
            {bike.travelForkMm && (
              <span className="bike-card-stat">
                <span className="bike-card-stat-value">{bike.travelForkMm}mm</span> front
              </span>
            )}
            {bike.travelShockMm && (
              <span className="bike-card-stat">
                <span className="bike-card-stat-value">{bike.travelShockMm}mm</span> rear
              </span>
            )}
            {bike.spokesUrl && (
              <a
                href={bike.spokesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bike-card-link"
              >
                99spokes <FaExternalLinkAlt size={10} />
              </a>
            )}
          </div>

          {/* Component Health Preview */}
          {sortedComponents.length > 0 && (
            <div className="bike-card-health">
              <h4 className="bike-card-health-title">Component Health</h4>
              <div className="bike-card-health-grid">
                {sortedComponents.map((comp) => (
                  <div key={comp.componentId} className="bike-card-health-row">
                    <StatusDot status={comp.status} />
                    <div className="bike-card-health-info">
                      <span className="bike-card-health-label">
                        {formatComponentLabel(comp)}
                      </span>
                      {(comp.brand || comp.model) && (
                        <span className="bike-card-health-make">
                          {[comp.brand, comp.model].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </div>
                    <span className="bike-card-health-hours">
                      {formatHours(comp.hoursRemaining)}
                    </span>
                  </div>
                ))}
              </div>
              <Link to={`/gear/${bike.id}`} className="bike-card-health-more">
                Edit Bike Details
              </Link>
            </div>
          )}

          {/* Notes */}
          {bike.notes && (
            <p className="text-sm text-sage">
              <span className="font-medium">Notes:</span> {bike.notes}
            </p>
          )}

          {/* Actions */}
          <div className="bike-card-actions">
            {onLogService && (
              <Button
                variant="primary"
                size="sm"
                onClick={onLogService}
              >
                <FaWrench size={12} className="icon-left" />
                Log service
              </Button>
            )}
            <Link to={`/gear/${bike.id}`} className="btn-secondary btn-sm">
              <FaEye size={12} className="icon-left" />
              View details
            </Link>
          </div>
        </div>

        {/* Right column: bike image */}
        <div className="bike-card-image-container">
          {bike.thumbnailUrl ? (
            <img
              src={bike.thumbnailUrl}
              alt={`${bike.year} ${bike.manufacturer} ${bike.model}`}
              className="bike-card-image"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                if (placeholder) placeholder.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className="bike-card-image-placeholder"
            style={{ display: bike.thumbnailUrl ? 'none' : 'flex' }}
          >
            <FaBicycle size={40} />
          </div>
        </div>
      </div>
    </motion.article>
  );
}
