// src/components/AddComponentModal.tsx
import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPSERT_BIKE_COMPONENT } from '../graphql/components';
import { BIKES } from '../graphql/bikes';

const COMPONENT_TYPES = ['FORK', 'SHOCK', 'WHEELSET', 'DROPPERPOST'] as const;
type ComponentType = typeof COMPONENT_TYPES[number];

export default function AddComponentModal({
  bikeId,
  presetType,
  onClose,
  existingForType, // optional: pass the current component for this type if present
}: {
  bikeId: string;
  presetType?: ComponentType;
  onClose: () => void;
  existingForType?: {
    id: string;
    type: ComponentType;
    manufacturer: string;
    model: string;
    year?: number | null;
  } | null;
}) {
  const [type, setType] = useState<ComponentType>(presetType ?? 'FORK');
  const [manufacturer, setManufacturer] = useState(existingForType?.manufacturer ?? '');
  const [model, setModel] = useState(existingForType?.model ?? '');
  const [year, setYear] = useState<number | ''>(existingForType?.year ?? '');

  const [mutate, { loading, error }] = useMutation(UPSERT_BIKE_COMPONENT, {
    refetchQueries: [{ query: BIKES }],
    onCompleted: onClose,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await mutate({
      variables: {
        input: {
          bikeId,
          type,
          manufacturer: manufacturer.trim(),
          model: model.trim(),
          year: year === '' ? null : Number(year),
        },
      },
    }).catch(() => {});
  }

  const inputCls =
    'w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]';
  const labelCls = 'block text-sm text-muted';

  const replacing = !!existingForType && existingForType.type === type;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-lg bg-surface border border-app rounded-xl shadow p-6 space-y-4">
        <h3 className="text-heading text-xl">{replacing ? 'Replace Component' : 'Add Component'}</h3>

        <div className="space-y-1">
          <label className={labelCls}>Type</label>
          <select
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as ComponentType)}
            disabled={!!presetType}
          >
            {COMPONENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {replacing && (
            <div className="text-xs text-muted">
              Replacing existing {type}: {existingForType?.manufacturer} {existingForType?.model}
              {existingForType?.year ? ` (${existingForType.year})` : ''}.
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Manufacturer</label>
          <input className={inputCls} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} required />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Model</label>
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} required />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Year (optional)</label>
          <input
            className={inputCls}
            type="number"
            min={1990}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>

        {error && <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>{error.message}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Saving…' : replacing ? 'Replace' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
