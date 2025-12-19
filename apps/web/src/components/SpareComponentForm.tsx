import { useState, useEffect } from "react";
import { Button } from "./ui";
import type { SpareFormState } from "@/models/BikeComponents";

type SpareFormProps = {
  initial: SpareFormState;
  submitting: boolean;
  error: string | null;
  onSubmit: (form: SpareFormState) => void;
  onClose: () => void;
};

export function SpareComponentForm({ initial, submitting, error, onSubmit, onClose }: SpareFormProps) {
  const [form, setForm] = useState<SpareFormState>(initial);

  const spareTypeOptions: SpareFormState['type'][] = ['FORK', 'SHOCK', 'DROPPER', 'WHEELS'];


  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const setField = <K extends keyof SpareFormState>(key: K, value: SpareFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    onSubmit(form);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-2 text-sm">
        <span className="label-muted">Component Type</span>
        <select
          className="max-w-auto rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
          value={form.type}
          onChange={(e) => setField('type', e.target.value as SpareFormState['type'])}
          disabled={!!form.id}
        >
          {spareTypeOptions.map((type) => (
            <option value={type} key={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs label-muted">
        <input
          type="checkbox"
          checked={form.isStock}
          onChange={(e) => setField('isStock', e.target.checked)}
        />
        Stock/OEM spec
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <input
          className="max-w-auto rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
          placeholder="Brand"
          value={form.brand}
          disabled={form.isStock}
          onChange={(e) => setField('brand', e.target.value)}
        />
        <input
          className="max-w-auto rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
          placeholder="Model"
          value={form.model}
          disabled={form.isStock}
          onChange={(e) => setField('model', e.target.value)}
        />
      </div>
      <label className="flex flex-col gap-2 text-sm">
        <span className="label-muted">Notes</span>
        <textarea
          className="resize-y placeholder:text-muted"
          rows={3}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Condition, travel, offset..."
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span className="label-muted">Hours Used</span>
          <input
            type="number"
            className="max-w-auto rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
            value={form.hoursUsed}
            onChange={(e) => setField('hoursUsed', e.target.value)}
            min={0}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="label-muted">Service Due @ (hours)</span>
          <input
            type="number"
            className="max-w-auto rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
            value={form.serviceDueAtHours}
            onChange={(e) => setField('serviceDueAtHours', e.target.value)}
            min={0}
          />
        </label>
      </div>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-app pt-4 md:flex-row md:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : form.id ? 'Update Spare' : 'Add Spare'}
        </Button>
      </div>
    </form>
  );
}