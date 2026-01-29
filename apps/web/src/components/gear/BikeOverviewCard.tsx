import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { FaBicycle, FaWrench, FaPencilAlt, FaTrash, FaExternalLinkAlt } from 'react-icons/fa';
import { Button } from '../ui/Button';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';
import { StatusDot } from '../dashboard/StatusDot';
import type { PredictionStatus, BikePredictionSummary } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';

function isValid99SpokesUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === '99spokes.com' || parsed.hostname.endsWith('.99spokes.com');
  } catch {
    return false;
  }
}

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
  location?: string | null;
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
  isDeleting,
}: BikeOverviewCardProps) {
  const { hoursDisplay } = useHoursDisplay();
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
    const hoursA = a.hoursRemaining ?? Infinity;
    const hoursB = b.hoursRemaining ?? Infinity;
    return hoursA - hoursB;
  });

  const menuItems: KebabMenuItem[] = [
    {
      label: 'Edit bike',
      icon: <FaPencilAlt size={12} />,
      onClick: onEdit,
    },
    {
      label: isDeleting ? 'Deleting...' : 'Delete bike',
      icon: <FaTrash size={12} />,
      onClick: onDelete,
      danger: true,
      disabled: isDeleting,
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
      {/* Header with inline image */}
      <header className="bike-card-header">
        <div className="bike-card-header-main">
          {/* Bike thumbnail inline with title */}
          <div className="bike-card-header-image">
            {bike.thumbnailUrl ? (
              <img
                src={bike.thumbnailUrl}
                alt={`${bike.year} ${bike.manufacturer} ${bike.model}`}
                className="bike-card-header-img"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                  if (placeholder) placeholder.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="bike-card-header-img-placeholder"
              style={{ display: bike.thumbnailUrl ? 'none' : 'flex' }}
            >
              <FaBicycle size={48} />
            </div>
          </div>

          <div className="bike-card-header-content">
            <p className="bike-card-manufacturer">{bike.manufacturer}</p>
            <div className="bike-card-title-row">
              <h3 className="bike-card-name">{bikeName}</h3>
              {/* Stats inline with title */}
              {(bike.travelForkMm || bike.travelShockMm) && (
                <>
                  <span className="bike-card-title-separator" />
                  <div className="bike-card-stats-inline">
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
                  </div>
                </>
              )}
            </div>
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
        </div>

        <KebabMenu items={menuItems} ariaLabel={`Actions for ${bikeName}`} />
      </header>

      {/* Body - Full width content */}
      <div className="bike-card-body">
        <div className="bike-card-content">
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
                      {hoursDisplay === 'total'
                        ? `${formatHours(comp.hoursSinceService)} / ${comp.serviceIntervalHours}h`
                        : formatHours(comp.hoursRemaining)}
                    </span>
                  </div>
                ))}
              </div>
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
              <FaPencilAlt size={12} className="icon-left" />
              Edit details
            </Link>
            {isValid99SpokesUrl(bike.spokesUrl) && (
              <a
                href={bike.spokesUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary btn-sm"
              >
                99spokes <FaExternalLinkAlt size={10} className="icon-right" />
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
