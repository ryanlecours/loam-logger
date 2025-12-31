import type { ComponentPrediction } from '../../types/prediction';
import { formatComponentLabel } from '../../utils/formatters';
import { StatusDot } from './StatusDot';

interface MiniComponentListProps {
  components: ComponentPrediction[];
  className?: string;
}

export function MiniComponentList({ components, className = '' }: MiniComponentListProps) {
  if (components.length === 0) {
    return (
      <div className={`mini-component-list ${className}`.trim()}>
        <div className="mini-component-row" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--sage)', fontSize: '0.875rem' }}>
            All components healthy
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`mini-component-list ${className}`.trim()}>
      {components.map((component) => (
        <div key={component.componentId} className="mini-component-row">
          <StatusDot status={component.status} />
          <span className="mini-component-label">
            {formatComponentLabel(component)}
          </span>
          <span className="mini-component-hours">
            {component.hoursRemaining.toFixed(1)} hrs
          </span>
          <span className="mini-component-rides">
            ~{component.ridesRemainingEstimate} rides
          </span>
        </div>
      ))}
    </div>
  );
}
