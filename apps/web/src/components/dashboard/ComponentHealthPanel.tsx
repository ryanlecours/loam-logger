import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { FaChevronRight, FaCheck, FaWrench } from 'react-icons/fa';
import type { ComponentPrediction } from '../../types/prediction';
import { STATUS_SEVERITY } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';
import { StatusDot } from './StatusDot';
import { SNOOZE_COMPONENT } from '../../graphql/calibration';
import { BIKES } from '../../graphql/bikes';

interface ComponentHealthPanelProps {
  components: ComponentPrediction[];
  className?: string;
  onLogService?: (componentId: string) => void;
}

/**
 * Format hours for display, handling edge cases like negative values and -0
 */
function formatHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '—';
  // Clamp negative to 0 and handle -0
  const safeHours = Math.max(0, hours);
  return `${safeHours.toFixed(1)} hrs`;
}

/**
 * Sort components by urgency for the health panel
 * 1. Status severity (OVERDUE > DUE_NOW > DUE_SOON > ALL_GOOD)
 * 2. Hours remaining (ascending - most urgent first)
 * 3. Alphabetical tie-breaker
 */
function getSortedComponentsForHealth(
  components: ComponentPrediction[]
): ComponentPrediction[] {
  return [...components].sort((a, b) => {
    // 1. Status severity (higher = more urgent, so b - a for descending)
    const severityDiff = STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status];
    if (severityDiff !== 0) return severityDiff;

    // 2. Hours remaining (ascending - most urgent first)
    const hoursDiff = a.hoursRemaining - b.hoursRemaining;
    if (hoursDiff !== 0) return hoursDiff;

    // 3. Alphabetical tie-breaker
    const labelA = formatComponentLabel(a);
    const labelB = formatComponentLabel(b);
    return labelA.localeCompare(labelB);
  });
}

/**
 * Get make/model display string - returns "Stock" if no brand/model provided
 */
function getMakeModel(component: ComponentPrediction): string {
  const brand = component.brand?.trim();
  const model = component.model?.trim();

  if (brand && model) {
    return `${brand} ${model}`;
  }
  if (brand) {
    return brand;
  }
  if (model) {
    return model;
  }
  return 'Stock';
}

/**
 * Definitions for each wear factor to explain what they mean
 */
const WEAR_FACTOR_DEFINITIONS: Record<string, string> = {
  steepness: 'Measures terrain difficulty and effort intensity. Steeper, more technical trails accelerate component wear through increased stress and heat.',
  hours: 'Total saddle time directly correlates with component fatigue. Longer rides mean more cycles of stress on bearings, seals, and moving parts.',
  climbing: 'Elevation gain puts extra load on drivetrain components. Climbing generates higher chain tension and increases brake pad wear on descents.',
  distance: 'Cumulative miles contribute to gradual wear across all components. More distance means more rotations, friction, and environmental exposure.',
  speed: 'Higher average speeds increase heat buildup in brakes and stress on suspension components through faster compression cycles.',
  temperature: 'Extreme temperatures affect lubricant viscosity and seal integrity. Heat degrades oils faster while cold makes seals brittle.',
  conditions: 'Wet, muddy, or dusty conditions accelerate wear by introducing contaminants that act as abrasives on moving parts.',
};

/**
 * Get the definition for a wear factor, with fallback
 */
function getFactorDefinition(factor: string): string {
  return WEAR_FACTOR_DEFINITIONS[factor.toLowerCase()]
    ?? 'This factor contributes to overall component wear based on your riding patterns.';
}

/**
 * Overlay for showing component details, wear causes, and quick actions
 */
interface ComponentDetailOverlayProps {
  component: ComponentPrediction;
  onClose: () => void;
  onServiceLogged?: () => void;
  onLogService?: (componentId: string) => void;
}

function ComponentDetailOverlay({ component, onClose, onServiceLogged, onLogService }: ComponentDetailOverlayProps) {
  const makeModel = getMakeModel(component);
  const onCloseRef = useRef(onClose);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [snoozeSuccess, setSnoozeSuccess] = useState(false);
  const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customHours, setCustomHours] = useState('');

  const [snoozeComponent] = useMutation(SNOOZE_COMPONENT, {
    refetchQueries: [{ query: BIKES }],
  });

  // Keep ref updated with latest onClose
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Handle escape key to close modal - uses ref to avoid listener churn
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const handleSnooze = async (hours?: number) => {
    setIsSnoozing(true);
    try {
      await snoozeComponent({
        variables: {
          id: component.componentId,
          hours,
        },
      });
      setSnoozeSuccess(true);
      onServiceLogged?.();
      // Auto-close after a short delay to show success
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Failed to snooze component:', err);
      alert('Failed to snooze component. Please try again.');
    } finally {
      setIsSnoozing(false);
    }
  };

  // Recommended snooze hours = service interval
  const recommendedHours = component.serviceIntervalHours ?? 50;

  const handleLooksGoodClick = () => {
    setShowSnoozeOptions(true);
  };

  return (
    <div
      className="wear-causes-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="component-detail-title"
    >
      <div className="wear-causes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wear-causes-header">
          <h3 className="wear-causes-title" id="component-detail-title">
            {formatComponentLabel(component)}
            <span className="wear-causes-make-model">{makeModel}</span>
          </h3>
          <button className="wear-causes-close" onClick={onClose}>×</button>
        </div>

        {/* Quick Actions - Tab-like buttons */}
        <div className="component-detail-actions">
          <button
            className={`component-action-btn component-action-good ${showSnoozeOptions ? 'active' : ''} ${snoozeSuccess ? 'success' : ''}`}
            onClick={handleLooksGoodClick}
            disabled={isSnoozing || snoozeSuccess}
            type="button"
          >
            <FaCheck size={14} />
            <span>{snoozeSuccess ? 'Snoozed!' : 'Looks Good'}</span>
          </button>

          {onLogService && (
            <button
              className="component-action-btn component-action-service"
              onClick={() => {
                onClose();
                onLogService(component.componentId);
              }}
              disabled={isSnoozing || snoozeSuccess}
              type="button"
            >
              <FaWrench size={14} />
              <span>Log Service</span>
            </button>
          )}
        </div>

        {/* Snooze options - only shown after clicking Looks Good */}
        {showSnoozeOptions && !snoozeSuccess && (
          <div className="component-snooze-section">
            <div className="component-snooze-options">
              <button
                type="button"
                className="component-snooze-option"
                onClick={() => handleSnooze(recommendedHours)}
                disabled={isSnoozing}
              >
                {isSnoozing ? 'Snoozing...' : `Snooze ${recommendedHours}h`}
              </button>
              <span className="component-snooze-divider">or</span>
              {!showCustomInput ? (
                <button
                  type="button"
                  className="component-snooze-link"
                  onClick={() => setShowCustomInput(true)}
                  disabled={isSnoozing}
                >
                  custom duration
                </button>
              ) : (
                <div className="component-snooze-custom">
                  <input
                    type="number"
                    min="1"
                    max="400"
                    placeholder="Hours"
                    value={customHours}
                    onChange={(e) => setCustomHours(e.target.value)}
                    className="component-snooze-input"
                    autoFocus
                  />
                  <span className="component-snooze-unit">h</span>
                  <button
                    className="component-snooze-apply"
                    onClick={() => handleSnooze(Number(customHours))}
                    disabled={
                      isSnoozing ||
                      !customHours ||
                      Number(customHours) < 1 ||
                      Number(customHours) > 400
                    }
                    type="button"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Component Stats */}
        <div className="component-detail-stats">
          <div className="component-detail-stat">
            <span className="component-detail-stat-value">{formatHours(component.hoursRemaining)}</span>
            <span className="component-detail-stat-label">Until next service</span>
          </div>
          <div className="component-detail-stat">
            <span className="component-detail-stat-value">{formatHours(component.hoursSinceService)}</span>
            <span className="component-detail-stat-label">Since last service</span>
          </div>
          <div className="component-detail-stat">
            <span className="component-detail-stat-value">{formatHours(component.serviceIntervalHours)}</span>
            <span className="component-detail-stat-label">Service interval</span>
          </div>
          <div className="component-detail-stat">
            <span className="component-detail-stat-value">~{component.ridesRemainingEstimate}</span>
            <span className="component-detail-stat-label">Rides remaining</span>
          </div>
        </div>

        {component.why && (
          <div className="wear-causes-why">
            <p>{component.why}</p>
          </div>
        )}

        {component.drivers && component.drivers.length > 0 && (
          <div className="wear-causes-drivers">
            <h4 className="wear-causes-drivers-title">Wear Factors</h4>
            <div className="wear-causes-drivers-list">
              {component.drivers.map((driver) => (
                <div key={`${component.componentId}-${driver.factor}`} className="wear-driver">
                  <div className="wear-driver-header">
                    <span className="wear-driver-label">{driver.label}</span>
                    <span className="wear-driver-contribution">{driver.contribution}%</span>
                  </div>
                  <div className="wear-driver-bar">
                    <div
                      className="wear-driver-bar-fill"
                      style={{ width: `${Math.max(0, Math.min(100, Number(driver.contribution) || 0))}%` }}
                    />
                  </div>
                  <p className="wear-driver-definition">{getFactorDefinition(driver.factor)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!component.why && (!component.drivers || component.drivers.length === 0) && (
          <div className="wear-causes-empty">
            <p>No wear analysis available for this component.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ComponentHealthPanel({ components, className = '', onLogService }: ComponentHealthPanelProps) {
  const [selectedComponent, setSelectedComponent] = useState<ComponentPrediction | null>(null);
  const { hoursDisplay } = useHoursDisplay();

  const sortedComponents = useMemo(
    () => getSortedComponentsForHealth(components),
    [components]
  );

  // Empty state
  if (components.length === 0) {
    return (
      <div className={`component-health-panel ${className}`.trim()}>
        <div className="component-health-header">
          <h3 className="component-health-title">Component Health</h3>
        </div>
        <div className="component-health-empty">
          <span>No components configured</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`component-health-panel ${className}`.trim()}>
      <div className="component-health-header">
        <h3 className="component-health-title">Component Health</h3>
        <p className="component-health-hint">Tap any component for details</p>
      </div>

      <div className="component-health-list list-stagger">
        {sortedComponents.map((component) => {
          const makeModel = getMakeModel(component);

          return (
            <button
              key={component.componentId}
              className="component-health-row"
              onClick={() => setSelectedComponent(component)}
              type="button"
            >
              <StatusDot status={component.status} />
              <div className="component-health-name">
                <span className="component-health-label">
                  {formatComponentLabel(component)}
                </span>
                <span className="component-health-make-model">{makeModel}</span>
              </div>
              <div className="component-health-metrics">
                {hoursDisplay === 'total' ? (
                  <>
                    <span className="component-health-hours-primary">
                      {formatHours(component.hoursSinceService)} / {component.serviceIntervalHours}h
                    </span>
                    <span className="component-health-hours-secondary">
                      {formatHours(component.hoursRemaining)} remaining · ~{component.ridesRemainingEstimate} rides
                    </span>
                  </>
                ) : (
                  <>
                    <span className="component-health-hours-primary">
                      {formatHours(component.hoursRemaining)} remaining
                    </span>
                    <span className="component-health-hours-secondary">
                      {formatHours(component.hoursSinceService)} since service · ~{component.ridesRemainingEstimate} rides
                    </span>
                  </>
                )}
              </div>
              <FaChevronRight className="component-health-chevron" size={12} />
            </button>
          );
        })}
      </div>

      {selectedComponent && (
        <ComponentDetailOverlay
          component={selectedComponent}
          onClose={() => setSelectedComponent(null)}
          onLogService={onLogService}
        />
      )}
    </div>
  );
}
