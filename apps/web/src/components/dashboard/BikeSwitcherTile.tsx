import { FaBicycle } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { PredictionStatus } from '../../types/prediction';
import { getBikeName } from '../../utils/formatters';
import { useHoursDisplay } from '../../hooks/useHoursDisplay';

interface BikeSwitcherTileProps {
  bike: BikeWithPredictions;
  isSelected: boolean;
  onClick: () => void;
}

const STATUS_CLASSES: Record<PredictionStatus, string> = {
  OVERDUE: 'status-dot-overdue',
  DUE_NOW: 'status-dot-due-now',
  DUE_SOON: 'status-dot-due-soon',
  ALL_GOOD: 'status-dot-all-good',
};

export function BikeSwitcherTile({ bike, isSelected, onClick }: BikeSwitcherTileProps) {
  const { hoursDisplay } = useHoursDisplay();
  const status = bike.predictions?.overallStatus ?? 'ALL_GOOD';
  const statusClass = STATUS_CLASSES[status];
  const bikeName = getBikeName(bike);
  const priorityComp = bike.predictions?.priorityComponent;

  return (
    <button
      className={`bike-tile ${isSelected ? 'bike-tile-selected' : ''}`}
      onClick={onClick}
      title={bikeName}
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
