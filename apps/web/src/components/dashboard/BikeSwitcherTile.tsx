import { FaBicycle } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { PredictionStatus } from '../../types/prediction';
import { getBikeName } from '../../utils/formatters';

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
  const status = bike.predictions?.overallStatus ?? 'ALL_GOOD';
  const statusClass = STATUS_CLASSES[status];
  const bikeName = getBikeName(bike);
  const hoursRemaining = bike.predictions?.priorityComponent?.hoursRemaining;

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
      {hoursRemaining !== undefined && status !== 'ALL_GOOD' && (
        <span className="bike-tile-hours">{hoursRemaining.toFixed(1)} hrs</span>
      )}
    </button>
  );
}
