import { useEffect, useState } from 'react';
import {
  BIKE_COMPONENT_SECTIONS,
  type BikeComponentSection,
  type BikeFormProps,
  type BikeFormValues,
  type GearComponentState,
} from '@/models/BikeComponents';
import { MOUNTAIN_BIKE_BRANDS } from '@/constants/bikeBrands';
import { BIKE_MODELS } from '@/constants/bikeModels';



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
    // Reset model when manufacturer changes to ensure consistency
    if (key === 'manufacturer') {
      setForm((prev) => ({ ...prev, [key]: value, model: '' }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
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
          <select
            className={inputClass}
            value={form.manufacturer}
            onChange={(e) => setField('manufacturer', e.target.value)}
            required
          >
            <option value="">Select a brand</option>
            {MOUNTAIN_BIKE_BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Model</span>
          <select
            className={inputClass}
            value={form.model}
            onChange={(e) => setField('model', e.target.value)}
            disabled={!form.manufacturer}
            required
          >
            <option value="">
              {form.manufacturer ? 'Select a model' : 'Select a manufacturer first'}
            </option>
            {form.manufacturer && BIKE_MODELS[form.manufacturer]?.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
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
                    required={!component.isStock}
                  />
                  <input
                    className={inputClass}
                    placeholder="Model"
                    value={component.model}
                    disabled={component.isStock}
                    onChange={(e) => setComponentField(section.key, 'model', e.target.value)}
                    required={!component.isStock}
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
          className="btn-primary"
          disabled={submitting}
        >
          {submitting ? 'Saving...' : mode === 'edit' ? 'Update Bike' : 'Create Bike'}
        </button>
      </div>
    </form>
  );
}

