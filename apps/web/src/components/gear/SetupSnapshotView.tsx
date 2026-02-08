import type { SetupSnapshot, SlotSnapshot } from '@loam/shared';
import { getComponentLabel } from '../../constants/componentLabels';

interface SetupSnapshotViewProps {
  snapshot: SetupSnapshot;
  compact?: boolean;
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '0h';
  return `${Math.max(0, hours).toFixed(1)}h`;
}

function formatSlotLocation(location: string): string {
  if (location === 'NONE' || !location) return '';
  return ` (${location.charAt(0) + location.slice(1).toLowerCase()})`;
}

function SlotItem({ slot, compact }: { slot: SlotSnapshot; compact?: boolean }) {
  const typeLabel = getComponentLabel(slot.componentType);
  const locationLabel = formatSlotLocation(slot.location);
  const comp = slot.component;

  if (!comp) {
    return (
      <div className={`flex items-center justify-between ${compact ? 'py-1' : 'py-1.5'}`}>
        <span className="text-sm text-muted">
          {typeLabel}{locationLabel}
        </span>
        <span className="text-sm text-muted italic">Empty</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between ${compact ? 'py-1' : 'py-1.5'}`}>
      <span className="text-sm text-muted">
        {typeLabel}{locationLabel}
      </span>
      <div className="text-right">
        <span className="text-sm text-app">
          {comp.brand} {comp.model}
        </span>
        <span className="ml-2 text-xs text-muted">
          {formatHours(comp.hoursUsed)}
        </span>
      </div>
    </div>
  );
}

function BikeSpecsSection({ snapshot, compact }: { snapshot: SetupSnapshot; compact?: boolean }) {
  const specs = snapshot.bikeSpecs;
  const hasSpecs = specs.travelForkMm || specs.travelShockMm || specs.isEbike;

  if (!hasSpecs) return null;

  return (
    <div className={`border-b border-app ${compact ? 'pb-2 mb-2' : 'pb-3 mb-3'}`}>
      <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-1">
        Bike Specs
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {specs.travelForkMm && (
          <div className="text-sm">
            <span className="text-muted">Fork:</span>{' '}
            <span className="text-app">{specs.travelForkMm}mm</span>
          </div>
        )}
        {specs.travelShockMm && (
          <div className="text-sm">
            <span className="text-muted">Shock:</span>{' '}
            <span className="text-app">{specs.travelShockMm}mm</span>
          </div>
        )}
        {specs.isEbike && (
          <>
            {specs.motorMaker && specs.motorModel && (
              <div className="text-sm">
                <span className="text-muted">Motor:</span>{' '}
                <span className="text-app">{specs.motorMaker} {specs.motorModel}</span>
              </div>
            )}
            {specs.batteryWh && (
              <div className="text-sm">
                <span className="text-muted">Battery:</span>{' '}
                <span className="text-app">{specs.batteryWh}Wh</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function SetupSnapshotView({ snapshot, compact = false }: SetupSnapshotViewProps) {
  // Group slots by category for organized display
  const suspensionSlots = snapshot.slots.filter(s =>
    ['FORK', 'SHOCK'].includes(s.componentType)
  );
  const drivetrainSlots = snapshot.slots.filter(s =>
    ['CHAIN', 'CASSETTE', 'CRANK', 'REAR_DERAILLEUR', 'DRIVETRAIN'].includes(s.componentType)
  );
  const brakeSlots = snapshot.slots.filter(s =>
    ['BRAKES', 'BRAKE_PAD', 'BRAKE_ROTOR'].includes(s.componentType)
  );
  const wheelSlots = snapshot.slots.filter(s =>
    ['TIRES', 'WHEEL_HUBS', 'RIMS'].includes(s.componentType)
  );
  const cockpitSlots = snapshot.slots.filter(s =>
    ['STEM', 'HANDLEBAR', 'SADDLE', 'SEATPOST', 'DROPPER'].includes(s.componentType)
  );
  const frameSlots = snapshot.slots.filter(s =>
    ['PIVOT_BEARINGS', 'HEADSET', 'BOTTOM_BRACKET'].includes(s.componentType)
  );
  const otherSlots = snapshot.slots.filter(s =>
    ['PEDALS', 'OTHER'].includes(s.componentType)
  );

  const categories = [
    { name: 'Suspension', slots: suspensionSlots },
    { name: 'Drivetrain', slots: drivetrainSlots },
    { name: 'Brakes', slots: brakeSlots },
    { name: 'Wheels', slots: wheelSlots },
    { name: 'Cockpit', slots: cockpitSlots },
    { name: 'Frame', slots: frameSlots },
    { name: 'Other', slots: otherSlots },
  ].filter(cat => cat.slots.length > 0);

  return (
    <div className={`rounded-md border border-app bg-surface-2 ${compact ? 'p-2' : 'p-3'}`}>
      <BikeSpecsSection snapshot={snapshot} compact={compact} />

      <div className={`grid ${compact ? 'gap-2' : 'gap-3'} ${categories.length > 2 ? 'sm:grid-cols-2' : ''}`}>
        {categories.map((category) => (
          <div key={category.name}>
            <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-1">
              {category.name}
            </h4>
            <div className="divide-y divide-app/50">
              {category.slots.map((slot) => (
                <SlotItem key={slot.slotKey} slot={slot} compact={compact} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={`${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-app text-xs text-muted`}>
        Captured {new Date(snapshot.capturedAt).toLocaleString()}
      </div>
    </div>
  );
}
