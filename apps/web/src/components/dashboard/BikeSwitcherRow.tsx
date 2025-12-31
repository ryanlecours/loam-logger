import { Link } from 'react-router-dom';
import { FaPlus } from 'react-icons/fa';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { BikeSwitcherTile } from './BikeSwitcherTile';

interface BikeSwitcherRowProps {
  bikes: BikeWithPredictions[];
  selectedBikeId: string | null;
  onSelect: (bikeId: string) => void;
  maxVisible?: number;
}

export function BikeSwitcherRow({
  bikes,
  selectedBikeId,
  onSelect,
  maxVisible = 8,
}: BikeSwitcherRowProps) {
  if (bikes.length <= 1) {
    return null;
  }

  const visibleBikes = bikes.slice(0, maxVisible);
  const hasMore = bikes.length > maxVisible;

  return (
    <div className="bike-switcher-row">
      {visibleBikes.map((bike) => (
        <BikeSwitcherTile
          key={bike.id}
          bike={bike}
          isSelected={bike.id === selectedBikeId}
          onClick={() => onSelect(bike.id)}
        />
      ))}
      {hasMore && (
        <Link to="/gear" className="bike-tile-more">
          <FaPlus className="bike-tile-more-icon" />
          <span className="bike-tile-more-text">
            +{bikes.length - maxVisible} more
          </span>
        </Link>
      )}
    </div>
  );
}
