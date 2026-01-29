import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FaChevronDown, FaPencilAlt } from 'react-icons/fa';
import { StatusDot } from '../dashboard/StatusDot';
import type { PredictionStatus } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';

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
  baselineWearPercent?: number | null;
  baselineMethod?: string | null;
  baselineConfidence?: string | null;
  lastServicedAt?: string | null;
  location?: string | null;
};

type ComponentPrediction = {
  componentId: string;
  componentType: string;
  location?: string | null;
  brand?: string | null;
  model?: string | null;
  status: PredictionStatus;
  hoursRemaining: number;
  ridesRemainingEstimate?: number | null;
  confidence?: string | null;
  currentHours?: number | null;
  serviceIntervalHours?: number | null;
  hoursSinceService?: number | null;
};

interface ComponentDetailRowProps {
  component: ComponentDto;
  prediction?: ComponentPrediction | null;
  onEdit: () => void;
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '—';
  const safeHours = Math.max(0, hours);
  return `${safeHours.toFixed(1)}h`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatBaselineMethod(method: string | null | undefined): string {
  if (!method) return '—';
  const labels: Record<string, string> = {
    manual: 'Manual',
    inferred: 'Inferred from rides',
    default: 'Default',
  };
  return labels[method] || method;
}

function truncateLabel(label: string, maxLength: number = 28): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength).trim() + '...';
}

export function ComponentDetailRow({
  component,
  prediction,
  onEdit,
}: ComponentDetailRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { hoursDisplay } = useHoursDisplay();

  const status = prediction?.status ?? 'ALL_GOOD';
  const hoursRemaining = prediction?.hoursRemaining;

  // Get brand/model from prediction or component
  // Skip "Stock" brand - that's a placeholder, not real component data
  const brand = prediction?.brand || component.brand;
  const model = prediction?.model || component.model;
  const hasRealBrandModel = brand && model && brand !== 'Stock';
  const brandModel = hasRealBrandModel ? `${brand} ${model}`.trim() : '';

  // Show brand/model if available, otherwise fall back to type label (truncated for display)
  const fullLabel = brandModel || formatComponentLabel(prediction || { componentType: component.type, location: component.location });
  const componentLabel = truncateLabel(fullLabel);

  return (
    <div
      className={`component-detail-row ${isExpanded ? 'component-detail-row-expanded' : ''}`}
    >
      <div
        className="component-detail-summary"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <StatusDot status={status} />

        <div className="component-detail-info">
          <h4 className="component-detail-name">{componentLabel}</h4>
          <span className="component-detail-type">
            {formatComponentLabel({ componentType: component.type, location: prediction?.location ?? component.location })}
            {component.isStock ? ' · Stock' : ' · Aftermarket'}
          </span>
        </div>

        <div className="component-detail-actions">
          <div className="component-detail-metrics">
            {hoursDisplay === 'total' ? (
              prediction?.hoursSinceService != null && prediction?.serviceIntervalHours != null && (
                <>
                  <span className="component-detail-hours">
                    {formatHours(prediction.hoursSinceService)} / {prediction.serviceIntervalHours}h
                  </span>
                </>
              )
            ) : (
              hoursRemaining != null && (
                <>
                  <span className="component-detail-hours">
                    {formatHours(hoursRemaining)}
                  </span>
                  <span className="component-detail-hours-label">left</span>
                </>
              )
            )}
          </div>

          <button
            type="button"
            className="component-detail-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label={`Edit ${componentLabel}`}
          >
            <FaPencilAlt size={10} />
            Edit
          </button>

          <span className="component-detail-toggle">
            <span className="component-detail-toggle-label">
              {isExpanded ? 'Less' : 'More'}
            </span>
            <FaChevronDown size={12} className="component-detail-chevron" />
          </span>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="component-detail-expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="component-detail-expanded-inner">
              {/* Brand & Model */}
              <div className="component-detail-field">
                <span className="component-detail-field-label">Brand</span>
                <span className="component-detail-field-value">
                  {component.brand || '—'}
                </span>
              </div>
              <div className="component-detail-field">
                <span className="component-detail-field-label">Model</span>
                <span className="component-detail-field-value">
                  {component.model || '—'}
                </span>
              </div>

              {/* Hours & Service */}
              <div className="component-detail-field">
                <span className="component-detail-field-label">Current Hours</span>
                <span className="component-detail-field-value">
                  {formatHours(prediction?.currentHours ?? component.hoursUsed)}
                </span>
              </div>
              <div className="component-detail-field">
                <span className="component-detail-field-label">Service Interval</span>
                <span className="component-detail-field-value">
                  {formatHours(prediction?.serviceIntervalHours ?? component.serviceDueAtHours)}
                </span>
              </div>

              {/* Hours Since Service */}
              {prediction?.hoursSinceService != null && (
                <div className="component-detail-field">
                  <span className="component-detail-field-label">Hours Since Service</span>
                  <span className="component-detail-field-value">
                    {formatHours(prediction.hoursSinceService)}
                  </span>
                </div>
              )}

              {/* Last Serviced */}
              <div className="component-detail-field">
                <span className="component-detail-field-label">Last Serviced</span>
                <span className="component-detail-field-value">
                  {formatDate(component.lastServicedAt)}
                </span>
              </div>

              {/* Baseline Info */}
              {component.baselineWearPercent != null && (
                <div className="component-detail-field">
                  <span className="component-detail-field-label">Baseline Wear</span>
                  <span className="component-detail-field-value">
                    {component.baselineWearPercent}%
                    {component.baselineMethod && (
                      <span className="component-detail-field-value-muted">
                        {' '}({formatBaselineMethod(component.baselineMethod)})
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Confidence */}
              {prediction?.confidence && (
                <div className="component-detail-field">
                  <span className="component-detail-field-label">Confidence</span>
                  <span className="component-detail-field-value" style={{ textTransform: 'capitalize' }}>
                    {prediction.confidence.toLowerCase()}
                  </span>
                </div>
              )}

              {/* Rides Remaining */}
              {prediction?.ridesRemainingEstimate != null && (
                <div className="component-detail-field">
                  <span className="component-detail-field-label">Rides Remaining</span>
                  <span className="component-detail-field-value">
                    ~{prediction.ridesRemainingEstimate} rides
                  </span>
                </div>
              )}

              {/* Stock Component */}
              <div className="component-detail-field">
                <span className="component-detail-field-label">Type</span>
                <span className="component-detail-field-value">
                  {component.isStock ? 'Stock' : 'Aftermarket'}
                </span>
              </div>

              {/* Notes */}
              {component.notes && (
                <div className="component-detail-notes">
                  <span className="component-detail-field-label">Notes</span>
                  <p className="component-detail-notes-text">{component.notes}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
