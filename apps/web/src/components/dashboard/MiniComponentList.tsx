import type { ComponentPrediction } from '../../types/prediction';
import { StatusDot } from './StatusDot';

interface MiniComponentListProps {
  components: ComponentPrediction[];
  className?: string;
}

const COMPONENT_LABELS: Record<string, string> = {
  FORK: 'Fork',
  SHOCK: 'Shock',
  BRAKES: 'Brakes',
  DRIVETRAIN: 'Drivetrain',
  TIRES: 'Tires',
  CHAIN: 'Chain',
  CASSETTE: 'Cassette',
  CHAINRING: 'Chainring',
  WHEELS: 'Wheels',
  DROPPER: 'Dropper',
  PIVOT_BEARINGS: 'Pivot Bearings',
  BRAKE_PAD: 'Brake Pads',
  BRAKE_ROTOR: 'Brake Rotor',
  HEADSET: 'Headset',
  BOTTOM_BRACKET: 'Bottom Bracket',
};

const LOCATION_LABELS: Record<string, string> = {
  FRONT: 'Front',
  REAR: 'Rear',
  NONE: '',
};

function formatComponentLabel(component: ComponentPrediction): string {
  const baseLabel = COMPONENT_LABELS[component.componentType] ?? component.componentType;
  const locationLabel = LOCATION_LABELS[component.location] ?? '';

  if (locationLabel && component.location !== 'NONE') {
    return `${baseLabel} (${locationLabel})`;
  }
  return baseLabel;
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
