import { FaPlus, FaBoxOpen } from 'react-icons/fa';
import { MdOutlineElectricBolt } from 'react-icons/md';
import { GiCarWheel, GiSuspensionBridge } from 'react-icons/gi';
import { TbArrowAutofitHeight } from 'react-icons/tb';
import { Button } from '../ui/Button';

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
  WHEELS: <GiCarWheel size={16} />,
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
            Track spare forks, shocks, wheels, or droppers so you always know what's on deck.
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
                  <p className="spare-row-type">{component.type}</p>
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
