import { Button } from '../ui/Button';
import { FaPlus } from 'react-icons/fa';

interface GearPageHeaderProps {
  onAddBike: () => void;
  onAddSpare: () => void;
}

export function GearPageHeader({ onAddBike, onAddSpare }: GearPageHeaderProps) {
  return (
    <header className="gear-page-header">
      <div className="gear-page-header-content">
        <span className="gear-page-eyebrow">Gear</span>
        <h1 className="gear-page-title">Your bikes & components</h1>
        <p className="gear-page-subtitle">Track every bolt and bearing</p>
      </div>
      <div className="gear-page-actions">
        <Button onClick={onAddBike}>
          <FaPlus size={12} className="icon-left" />
          Add Bike
        </Button>
        <Button variant="outline" onClick={onAddSpare}>
          <FaPlus size={12} className="icon-left" />
          Add Spare Component
        </Button>
      </div>
    </header>
  );
}
