import { FaPlus, FaBoxOpen, FaWrench, FaHandPaper, FaCompactDisc, FaLink } from 'react-icons/fa';
import { MdOutlineElectricBolt } from 'react-icons/md';
import { GiCarWheel, GiSuspensionBridge, GiGears } from 'react-icons/gi';
import { TbArrowAutofitHeight } from 'react-icons/tb';
import { Button } from '../ui/Button';

type ComponentDto = {
  id: string;
  type: string;
  brand: string;
  model: string;
  notes?: string | null;
  location?: string | null;
  isStock: boolean;
  bikeId?: string | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

interface SpareComponentsPanelProps {
  components: ComponentDto[];
  onEdit: (component: ComponentDto) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  loading?: boolean;
  deleting?: boolean;
}

const COMPONENT_ICONS: Record<string, React.ReactNode> = {
  FORK: <GiSuspensionBridge size={16} />,
  SHOCK: <MdOutlineElectricBolt size={16} />,
  DROPPER: <TbArrowAutofitHeight size={16} />,
  WHEEL_HUBS: <GiCarWheel size={16} />,
  CHAIN: <FaLink size={16} />,
  CASSETTE: <GiGears size={16} />,
  CRANK: <GiGears size={16} />,
  REAR_DERAILLEUR: <GiGears size={16} />,
  DRIVETRAIN: <GiGears size={16} />,
  BRAKES: <FaHandPaper size={16} />,
  BRAKE_PAD: <FaHandPaper size={16} />,
  BRAKE_ROTOR: <FaCompactDisc size={16} />,
  TIRES: <GiCarWheel size={16} />,
  RIMS: <GiCarWheel size={16} />,
  STEM: <FaWrench size={16} />,
  HANDLEBAR: <FaWrench size={16} />,
  SADDLE: <FaWrench size={16} />,
  SEATPOST: <FaWrench size={16} />,
  PEDALS: <FaWrench size={16} />,
  PIVOT_BEARINGS: <FaWrench size={16} />,
  HEADSET: <FaWrench size={16} />,
  BOTTOM_BRACKET: <FaWrench size={16} />,
  OTHER: <FaBoxOpen size={16} />,
};

const COMPONENT_LABELS: Record<string, string> = {
  FORK: 'Fork',
  SHOCK: 'Rear Shock',
  DROPPER: 'Dropper Post',
  WHEEL_HUBS: 'Wheel Hubs',
  CHAIN: 'Chain',
  CASSETTE: 'Cassette',
  CRANK: 'Crankset',
  REAR_DERAILLEUR: 'Rear Derailleur',
  DRIVETRAIN: 'Drivetrain',
  BRAKES: 'Brake Fluid',
  BRAKE_PAD: 'Brake Pads',
  BRAKE_ROTOR: 'Brake Rotors',
  TIRES: 'Tires',
  RIMS: 'Rims',
  STEM: 'Stem',
  HANDLEBAR: 'Handlebar',
  SADDLE: 'Saddle',
  SEATPOST: 'Seatpost',
  PEDALS: 'Pedals',
  PIVOT_BEARINGS: 'Pivot Bearings',
  HEADSET: 'Headset',
  BOTTOM_BRACKET: 'Bottom Bracket',
  OTHER: 'Other',
};

export function SpareComponentsPanel({
  components,
  onEdit,
  onDelete,
  onAdd,
  loading = false,
  deleting = false,
}: SpareComponentsPanelProps) {
  return (
    <aside className="spares-panel">
      <header className="spares-panel-header">
        <h2 className="spares-panel-title">Spare Components</h2>
        <span className="spares-panel-count">{components.length}</span>
      </header>

      {loading ? (
        <div className="spares-panel-list">
          {[1, 2].map((i) => (
            <div key={i} className="spare-skeleton animate-pulse" />
          ))}
        </div>
      ) : components.length === 0 ? (
        <div className="spares-panel-empty">
          <FaBoxOpen size={32} className="spares-panel-empty-icon" />
          <p className="spares-panel-empty-text">
            Track spare components so you always know what's on deck for your next swap.
          </p>
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <FaPlus size={10} className="icon-left" />
            Add spare
          </Button>
        </div>
      ) : (
        <>
          <div className="spares-panel-list">
            {components.map((component) => (
              <div
                key={component.id}
                className="spare-row"
                onClick={() => onEdit(component)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdit(component);
                  }
                }}
              >
                <div className="spare-row-icon">
                  {COMPONENT_ICONS[component.type] || <FaBoxOpen size={16} />}
                </div>
                <div className="spare-row-content">
                  <p className="spare-row-type">
                    {COMPONENT_LABELS[component.type] || component.type}
                    {component.location && component.location !== 'NONE' && (
                      <span className="spare-row-location"> ({component.location.toLowerCase()})</span>
                    )}
                  </p>
                  <p className="spare-row-name">
                    {component.isStock
                      ? 'Stock spec'
                      : `${component.brand} ${component.model}`}
                  </p>
                  <p className="spare-row-meta">
                    {component.hoursUsed ?? 0}h used
                    {component.serviceDueAtHours != null && (
                      <> · Service @ {component.serviceDueAtHours}h</>
                    )}
                  </p>
                </div>
                <div className="spare-row-actions">
                  <button
                    type="button"
                    className="spare-row-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(component);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="spare-row-action spare-row-action-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(component.id);
                    }}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <Button variant="secondary" size="sm" onClick={onAdd}>
              <FaPlus size={10} className="icon-left" />
              Add spare
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}
