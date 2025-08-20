// src/components/BikeCard.tsx
import { useState } from 'react';
import AddComponentModal from '../components/AddComponentModal';
import ServiceModal from '../components/ServiceModal';

type Component = {
  id: string;
  type: 'FORK' | 'SHOCK' | 'WHEELSET' | 'DROPPERPOST';
  manufacturer: string;
  model: string;
  year?: number | null;
  hoursSinceService: number;
};

type Bike = {
  id: string;
  manufacturer: string;
  model: string;
  nickname?: string | null;
  pivotHoursSinceService?: number;       // may be missing in some responses
  isComplete?: boolean;                  // may be missing in some responses
  components?: Component[] | null;       // <-- make optional
};

const ORDERED: Component['type'][] = ['FORK', 'SHOCK', 'WHEELSET', 'DROPPERPOST'];

export default function BikeCard({ bike }: { bike: Bike }) {
  const title = bike.nickname || `${bike.manufacturer} ${bike.model}`;

  // Guard for undefined/null
  const components: Component[] = Array.isArray(bike.components) ? bike.components : [];
  const byType = Object.fromEntries(components.map(c => [c.type, c] as const));

  const isComplete = !!bike.isComplete; // default false if undefined
  const pivotHours = typeof bike.pivotHoursSinceService === 'number' ? bike.pivotHoursSinceService : 0;

  const [addingForType, setAddingForType] = useState<Component['type'] | null>(null);
  const [servicing, setServicing] = useState<
    | { pivot: true }
    | { pivot?: false; component: Component }
    | null
  >(null);

  return (
    <div className="border border-app bg-surface rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-heading">{title}</div>
        <span className={`text-xs px-2 py-1 rounded ${isComplete ? 'bg-accent text-accent-contrast' : 'bg-app border border-app'}`}>
          {isComplete ? 'Complete' : 'Incomplete'}
        </span>
      </div>

      {/* Pivot */}
      <div className="flex items-center justify-between text-sm">
        <div><b>Pivot Bearings:</b> {pivotHours.toFixed(1)} h</div>
        <button className="btn-outline" onClick={() => setServicing({ pivot: true })}>
          Service
        </button>
      </div>

      {/* Components */}
      <ul className="text-sm space-y-1 pt-1">
        {ORDERED.map((t) => {
          const c = byType[t] as Component | undefined;
          return (
            <li key={t} className="flex items-center justify-between gap-2">
              <div className="text-muted w-28">{t}</div>

              <div className="flex-1 min-w-0">
                {c ? (
                  <div className="truncate">
                    {c.manufacturer} {c.model}{c.year ? ` (${c.year})` : ''}
                  </div>
                ) : (
                  <em className="text-muted">— not installed —</em>
                )}
              </div>

              <div className="w-32 text-right">
                {c ? `${c.hoursSinceService.toFixed(1)} h` : ''}
              </div>

              <div className="flex gap-2">
                {c ? (
                  <>
                    <button className="btn-secondary" onClick={() => setAddingForType(t)}>Replace</button>
                    <button className="btn-primary" onClick={() => setServicing({ component: c })}>Service</button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={() => setAddingForType(t)}>Add</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Modals */}
      {addingForType && (
        <AddComponentModal
          bikeId={bike.id}
          presetType={addingForType}
          onClose={() => setAddingForType(null)}
          existingForType={byType[addingForType] as Component | undefined}
        />
      )}

      {servicing && servicing.pivot ? (
        <ServiceModal
          onClose={() => setServicing(null)}
          bikeId={bike.id}
          pivot={{ currentHours: pivotHours }}
        />
      ) : servicing && 'component' in servicing ? (
        <ServiceModal
          onClose={() => setServicing(null)}
          bikeId={bike.id}
          component={servicing.component}
        />
      ) : null}
    </div>
  );
}
