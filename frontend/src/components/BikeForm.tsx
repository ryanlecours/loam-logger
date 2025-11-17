import { useEffect, useState } from 'react';
import type {
  BikeComponentKey,
  BikeFormValues,
  GearComponentState,
} from '@/models/BikeComponents';

export const BIKE_COMPONENT_SECTIONS: ReadonlyArray<{
  key: BikeComponentKey;
  label: string;
  type: string;
}> = [
  { key: 'fork', label: 'Fork', type: 'FORK' },
  { key: 'shock', label: 'Shock', type: 'SHOCK' },
  { key: 'dropper', label: 'Dropper Post', type: 'DROPPER' },
  { key: 'wheels', label: 'Wheels', type: 'WHEELS' },
  { key: 'pivotBearings', label: 'Pivot Bearings', type: 'PIVOT_BEARINGS' },
];

export type BikeComponentSection = (typeof BIKE_COMPONENT_SECTIONS)[number];

export type BikeFormProps = {
  mode: 'create' | 'edit';
  initial: BikeFormValues;
  submitting: boolean;
  error: string | null;
  onSubmit: (form: BikeFormValues) => void;
  onClose: () => void;
};

export function BikeForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onClose,
}: BikeFormProps) {
  const [form, setForm] = useState<BikeFormValues>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const setField = (key: keyof BikeFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setComponentField = (
    key: BikeComponentSection['key'],
    prop: keyof GearComponentState,
    value: string | boolean
  ) => {
    setForm((prev) => ({
      ...prev,
      components: {
        ...prev.components,
        [key]: { ...prev.components[key], [prop]: value },
      },
    }));
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    onSubmit(form);
  };

  const inputClass =
    'w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]';

  const labelClass = 'block text-sm text-muted';

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-app rounded-xl shadow p-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Manufacturer</span>
          <input
            className={inputClass}
            value={form.manufacturer}
            onChange={(e) => setField('manufacturer', e.target.value)}
            placeholder="e.g. Transition"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Model</span>
          <input
            className={inputClass}
            value={form.model}
            onChange={(e) => setField('model', e.target.value)}
            placeholder="Smuggler"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Year</span>
          <input
            type="number"
            className={inputClass}
            value={form.year}
            onChange={(e) => setField('year', e.target.value)}
            min={1990}
            max={new Date().getFullYear() + 1}
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Nickname (optional)</span>
          <input
            className={inputClass}
            value={form.nickname}
            onChange={(e) => setField('nickname', e.target.value)}
            placeholder="Lunch laps rig"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Fork Travel (mm)</span>
          <input
            type="number"
            className={inputClass}
            value={form.travelForkMm}
            onChange={(e) => setField('travelForkMm', e.target.value)}
            placeholder="160"
            min={0}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Shock Travel (mm)</span>
          <input
            type="number"
            className={inputClass}
            value={form.travelShockMm}
            onChange={(e) => setField('travelShockMm', e.target.value)}
            placeholder="150"
            min={0}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Bike Notes</span>
        <textarea
          className={`${inputClass} resize-y`}
          rows={3}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Setup notes, service reminders..."
        />
      </label>

      <div className="space-y-4">
        <p className="text-heading text-base">Key Components</p>
        <div className="grid gap-3 md:grid-cols-2">
          {BIKE_COMPONENT_SECTIONS.map((section) => {
            const component = form.components[section.key];
            return (
              <div key={section.key} className="border border-app rounded-lg bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-heading">{section.label}</span>
                  <label className="flex items-center gap-2 text-xs text-muted uppercase">
                    <input
                      type="checkbox"
                      checked={component.isStock}
                      onChange={(e) => setComponentField(section.key, 'isStock', e.target.checked)}
                    />
                    Stock spec
                  </label>
                </div>
                <div className="space-y-2">
                  <input
                    className={inputClass}
                    placeholder="Brand"
                    value={component.brand}
                    disabled={component.isStock}
                    onChange={(e) => setComponentField(section.key, 'brand', e.target.value)}
                  />
                  <input
                    className={inputClass}
                    placeholder="Model"
                    value={component.model}
                    disabled={component.isStock}
                    onChange={(e) => setComponentField(section.key, 'model', e.target.value)}
                  />
                  <textarea
                    className={`${inputClass} resize-y`}
                    placeholder="Notes"
                    value={component.notes}
                    rows={2}
                    onChange={(e) => setComponentField(section.key, 'notes', e.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-accent"
          disabled={submitting}
        >
          {submitting ? 'Saving...' : mode === 'edit' ? 'Update Bike' : 'Add Bike'}
        </button>
      </div>
    </form>
  );
}

