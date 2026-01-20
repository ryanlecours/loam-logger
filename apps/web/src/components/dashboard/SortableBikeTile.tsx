import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaBicycle } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { PredictionStatus } from '../../types/prediction';
import { getBikeName } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';

interface SortableBikeTileProps {
  bike: BikeWithPredictions;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const STATUS_CLASSES: Record<PredictionStatus, string> = {
  OVERDUE: 'status-dot-overdue',
  DUE_NOW: 'status-dot-due-now',
  DUE_SOON: 'status-dot-due-soon',
  ALL_GOOD: 'status-dot-all-good',
};

export function SortableBikeTile({ bike, isSelected, onClick, disabled }: SortableBikeTileProps) {
  const { hoursDisplay } = useHoursDisplay();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: bike.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || disabled ? 0.5 : 1,
    cursor: disabled ? 'wait' : isDragging ? 'grabbing' : 'grab',
  };

  const status = bike.predictions?.overallStatus ?? 'ALL_GOOD';
  const statusClass = STATUS_CLASSES[status];
  const bikeName = getBikeName(bike);
  const priorityComp = bike.predictions?.priorityComponent;

  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`bike-tile ${isSelected ? 'bike-tile-selected' : ''} ${isDragging ? 'bike-tile-dragging' : ''}`}
      onClick={onClick}
      title={`${bikeName} (drag to reorder)`}
      {...attributes}
      {...listeners}
    >
      <div className="bike-tile-thumb">
        {bike.thumbnailUrl ? (
          <img src={bike.thumbnailUrl} alt={bikeName} />
        ) : (
          <FaBicycle />
        )}
        <span className={`bike-tile-status ${statusClass}`} />
      </div>
      <span className="bike-tile-name">{bikeName}</span>
      {priorityComp && status !== 'ALL_GOOD' && (
        <span className="bike-tile-hours">
          {hoursDisplay === 'total'
            ? `${(priorityComp.hoursSinceService ?? 0).toFixed(1)}/${priorityComp.serviceIntervalHours}h`
            : `${(priorityComp.hoursRemaining ?? 0).toFixed(1)} hrs`}
        </span>
      )}
    </button>
  );
}
