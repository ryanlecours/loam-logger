import { useMemo } from 'react';
import type { ComponentPrediction } from '../../types/prediction';
import { STATUS_SEVERITY } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { usePreferences } from '../../hooks/usePreferences';
import { StatusDot } from './StatusDot';

interface ComponentHealthPanelProps {
  components: ComponentPrediction[];
  className?: string;
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

export function ComponentHealthPanel({ components, className = '' }: ComponentHealthPanelProps) {
  const { hoursDisplay } = usePreferences();

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
      </div>

      <div className="component-health-list">
        {sortedComponents.map((component) => {
          // Determine which secondary hours value to show based on preference
          const secondaryHours = hoursDisplay === 'total'
            ? component.currentHours
            : component.hoursSinceService;

          return (
            <div key={component.componentId} className="component-health-row">
              <StatusDot status={component.status} />
              <span className="component-health-label">
                {formatComponentLabel(component)}
              </span>
              <div className="component-health-metrics">
                <span className="component-health-hours-primary">
                  {formatHours(component.hoursRemaining)} remaining
                </span>
                <span className="component-health-hours-secondary">
                  {formatHours(secondaryHours)} {hoursDisplay === 'total' ? 'total' : 'since service'}
                </span>
                <span className="component-health-rides">
                  ~{component.ridesRemainingEstimate} rides
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
