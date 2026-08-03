import type { ComponentPrediction } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';
import { StatusDot } from './StatusDot';

interface MiniComponentListProps {
  components: ComponentPrediction[];
  className?: string;
}

export function MiniComponentList({ components, className = '' }: MiniComponentListProps) {
  const { hoursDisplay } = useHoursDisplay();

  if (components.length === 0) {
    return (
      <div className={`mini-component-list ${className}`.trim()}>
        <div className="mini-component-row justify-center">
          <span className="text-sage text-sm">
            All components healthy
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`mini-component-list list-stagger ${className}`.trim()}>
      {components.map((component) => (
        <div key={component.componentId} className="mini-component-row">
          <StatusDot status={component.status} />
          <span className="mini-component-label">
            {formatComponentLabel(component)}
          </span>
          <span className="mini-component-hours">
            {hoursDisplay === 'total' || component.hoursRemaining == null
              ? `${component.hoursSinceService.toFixed(1)}/${component.serviceIntervalHours}h`
              : /* Clamped: hoursRemaining goes negative once a component is past
                   due, and "-42.0 hrs" reads as a rendering fault in a one-line
                   tile. The overdue magnitude is carried by the status dot and
                   by the total-mode string beside it. */
                `${Math.max(0, component.hoursRemaining).toFixed(1)} hrs`}
          </span>
          <span className="mini-component-rides">
            {component.ridesRemainingEstimate != null
              ? `~${component.ridesRemainingEstimate} rides`
              : `${component.ridesSinceService} rides since service`}
          </span>
        </div>
      ))}
    </div>
  );
}
