import { useEffect, useState } from 'react';
import {
  type BikeFormProps,
  type BikeFormValues,
  type SpokesComponentData,
} from '@/models/BikeComponents';
import { Input, Textarea, Button } from './ui';
import { BikeSearch, type SpokesSearchResult } from './BikeSearch';
import { useSpokes, type SpokesComponentEntry, type SpokesBikeDetails } from '@/hooks/useSpokes';
import { ALL_COMPONENT_TYPES } from '@loam/shared';

// Component entry for Step 2
type ComponentEntry = {
  key: string;
  label: string;
  value: string;        // Combined "Brand Model" string
  description: string;  // Optional description from 99spokes
  kind?: string;        // For seatpost dropper detection
};

// Helper to extract only GraphQL-allowed fields for SpokesComponentInput
const toSpokesInput = (comp: SpokesComponentEntry | null | undefined): SpokesComponentData | null => {
  if (!comp) return null;
  return {
    maker: comp.make || comp.maker || null,
    model: comp.model || null,
    description: comp.description || null,
    kind: comp.kind || null,
  };
};

// Build component entries from 99spokes data
const buildComponentEntries = (details: SpokesBikeDetails | null): ComponentEntry[] => {
  return ALL_COMPONENT_TYPES.map(({ key, label, spokesKey }) => {
    let brand = '';
    let model = '';
    let description = '';
    let kind: string | undefined;

    if (details?.components && spokesKey) {
      const comp = details.components[spokesKey as keyof typeof details.components] as SpokesComponentEntry | undefined;
      if (comp) {
        brand = comp.make || comp.maker || '';
        model = comp.model || '';
        description = comp.description || '';
        kind = comp.kind;
      }
    }

    // Special handling for suspension components
    if (key === 'fork' && details?.suspension?.front?.component) {
      const suspComp = details.suspension.front.component;
      brand = suspComp.make || brand;
      model = suspComp.model || model;
      description = suspComp.description || description;
    }
    if (key === 'rearShock' && details?.suspension?.rear?.component) {
      const suspComp = details.suspension.rear.component;
      brand = suspComp.make || brand;
      model = suspComp.model || model;
      description = suspComp.description || description;
    }

    // Combine brand and model into single value
    const value = [brand, model].filter(Boolean).join(' ').trim();

    // Update label for dropper posts
    const displayLabel = key === 'seatpost' && kind === 'dropper' ? 'Dropper Post' : label;

    return {
      key,
      label: displayLabel,
      value,
      description,
      kind,
    };
  });
};

// Build component entries from existing bike components (edit mode)
const buildComponentEntriesFromExisting = (initial: BikeFormValues): ComponentEntry[] => {
  return ALL_COMPONENT_TYPES.map(({ key, label }) => {
    // Map our component keys to the legacy BIKE_COMPONENT_SECTIONS keys
    const legacyKeyMap: Record<string, string> = {
      fork: 'fork',
      rearShock: 'shock',
      wheels: 'wheels',
      pivotBearings: 'pivotBearings',
      seatpost: 'dropper', // dropper was the legacy key
    };

    const legacyKey = legacyKeyMap[key];
    const existingComp = legacyKey ? initial.components[legacyKey as keyof typeof initial.components] : undefined;

    const value = existingComp
      ? [existingComp.brand, existingComp.model].filter(Boolean).join(' ').trim()
      : '';

    return {
      key,
      label,
      value,
      description: '',
    };
  });
};

export function BikeForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onClose,
}: BikeFormProps) {
  const [step, setStep] = useState<1 | 2>(mode === 'edit' ? 2 : 1);
  const [form, setForm] = useState<BikeFormValues>(initial);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [componentEntries, setComponentEntries] = useState<ComponentEntry[]>([]);
  const [spokesDetails, setSpokesDetails] = useState<SpokesBikeDetails | null>(null);
  const { getBikeDetails, isLoading: loadingDetails } = useSpokes();

  useEffect(() => {
    setForm(initial);
    // In edit mode, build component entries from existing data
    if (mode === 'edit') {
      setComponentEntries(buildComponentEntriesFromExisting(initial));
      // Show manual entry if editing an existing bike without spokesId
      if (initial.manufacturer && !initial.spokesId) {
        setShowManualEntry(true);
      }
    }
  }, [initial, mode]);

  const setField = (key: keyof BikeFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Handle bike selection from search
  const handleBikeSelect = async (bike: SpokesSearchResult) => {
    // Update basic fields from search result
    setForm((prev) => ({
      ...prev,
      spokesId: bike.id,
      manufacturer: bike.maker,
      model: bike.model,
      year: String(bike.year),
      family: bike.family || null,
      category: bike.category || null,
      subcategory: bike.subcategory || null,
    }));

    // Fetch full details for auto-fill
    const details = await getBikeDetails(bike.id);
    if (details) {
      setSpokesDetails(details);

      // Prefer travelMM from direct endpoint
      const forkTravel = details.suspension?.front?.travelMM || details.suspension?.front?.travel;
      const shockTravel = details.suspension?.rear?.travelMM || details.suspension?.rear?.travel;

      setForm((prev) => ({
        ...prev,
        travelForkMm: forkTravel ? String(forkTravel) : prev.travelForkMm,
        travelShockMm: shockTravel ? String(shockTravel) : prev.travelShockMm,
        spokesUrl: details.url || null,
        thumbnailUrl: details.thumbnailUrl || null,
        family: details.family || prev.family,
        category: details.category || prev.category,
        subcategory: details.subcategory || prev.subcategory,
        buildKind: details.buildKind || null,
        isFrameset: details.isFrameset ?? false,
        isEbike: details.isEbike ?? false,
        gender: details.gender || null,
        frameMaterial: details.frameMaterial || null,
        hangerStandard: details.hangerStandard || null,
        motorMaker: details.isEbike && details.components?.motor?.maker ? details.components.motor.maker : null,
        motorModel: details.isEbike && details.components?.motor?.model ? details.components.motor.model : null,
        motorPowerW: details.isEbike && details.components?.motor?.powerW ? details.components.motor.powerW : null,
        motorTorqueNm: details.isEbike && details.components?.motor?.torqueNm ? details.components.motor.torqueNm : null,
        batteryWh: details.isEbike && details.components?.battery?.capacityWh ? details.components.battery.capacityWh : null,
      }));

      // Build component entries for Step 2
      setComponentEntries(buildComponentEntries(details));
    } else {
      // No details found, use defaults
      setComponentEntries(buildComponentEntries(null));
    }
  };

  // Proceed to Step 2
  const handleContinue = () => {
    if (showManualEntry || !spokesDetails) {
      // For manual entry or when no details loaded, build empty component entries
      setComponentEntries(buildComponentEntries(null));
    }
    setStep(2);
  };

  // Go back to Step 1
  const handleBack = () => {
    setStep(1);
  };

  // Update a component entry value
  const updateComponentEntry = (key: string, value: string) => {
    setComponentEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, value } : entry))
    );
  };

  // Build final form data and submit
  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();

    // Build spokesComponents from entries (only GraphQL-allowed fields)
    const spokesComponents = spokesDetails?.components ? {
      fork: toSpokesInput(spokesDetails.components.fork),
      rearShock: toSpokesInput(spokesDetails.components.rearShock || spokesDetails.components.shock),
      brakes: toSpokesInput(spokesDetails.components.brakes),
      rearDerailleur: toSpokesInput(spokesDetails.components.rearDerailleur),
      crank: toSpokesInput(spokesDetails.components.crank),
      cassette: toSpokesInput(spokesDetails.components.cassette),
      rims: toSpokesInput(spokesDetails.components.rims),
      tires: toSpokesInput(spokesDetails.components.tires),
      stem: toSpokesInput(spokesDetails.components.stem),
      handlebar: toSpokesInput(spokesDetails.components.handlebar),
      saddle: toSpokesInput(spokesDetails.components.saddle),
      seatpost: spokesDetails.components.seatpost ? {
        ...toSpokesInput(spokesDetails.components.seatpost),
        kind: spokesDetails.components.seatpost.kind || null,
      } : null,
    } : null;

    // Build legacy components format for the 5 key components
    const getComponentData = (key: string) => {
      const entry = componentEntries.find((e) => e.key === key);
      if (!entry || !entry.value.trim()) {
        return { brand: '', model: '', notes: '', isStock: true };
      }
      // Parse value back into brand/model (first word = brand, rest = model)
      const parts = entry.value.trim().split(/\s+/);
      const brand = parts[0] || '';
      const model = parts.slice(1).join(' ') || '';
      return {
        brand,
        model,
        notes: '',
        isStock: false,
      };
    };

    // Map our new keys to the legacy BIKE_COMPONENT_SECTIONS keys
    const seatpostEntry = componentEntries.find((e) => e.key === 'seatpost');
    const isDropper = seatpostEntry?.kind === 'dropper';

    const finalForm: BikeFormValues = {
      ...form,
      spokesComponents,
      components: {
        fork: getComponentData('fork'),
        shock: getComponentData('rearShock'),
        dropper: isDropper ? getComponentData('seatpost') : { brand: '', model: '', notes: '', isStock: true },
        wheels: getComponentData('wheels'),
        pivotBearings: getComponentData('pivotBearings'),
      },
    };

    onSubmit(finalForm);
  };

  // Get initial search value for display
  const getSearchInitialValue = () => {
    if (form.manufacturer && form.model && form.year) {
      return `${form.year} ${form.manufacturer} ${form.model}`;
    }
    return '';
  };

  const canContinue = form.manufacturer && form.model && form.year;

  // Step 1: Bike Selection
  if (step === 1) {
    return (
      <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">
            {mode === 'edit' ? 'Edit Bike' : 'Add New Bike'}
          </h2>
          <span className="text-xs text-muted">Step 1 of 2</span>
        </div>

        {/* Bike Search */}
        <div className="space-y-2">
          <BikeSearch
            label="Search Bike"
            onSelect={handleBikeSelect}
            initialValue={mode === 'edit' ? getSearchInitialValue() : ''}
            hint="Search by brand, model, or year to auto-fill details"
          />
          {loadingDetails && (
            <p className="text-xs text-muted">Loading bike details...</p>
          )}
        </div>

        {/* Selected bike display */}
        {form.manufacturer && form.model && !showManualEntry && (
          <div className="rounded-lg bg-surface-2 p-4 border border-app">
            <div className="flex gap-4">
              {form.thumbnailUrl && (
                <img
                  src={form.thumbnailUrl}
                  alt={`${form.year} ${form.manufacturer} ${form.model}`}
                  className="w-24 h-18 object-contain rounded bg-white/5"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div className="flex-1">
                <p className="text-heading font-medium">
                  {form.year} {form.manufacturer} {form.model}
                </p>
                {(form.travelForkMm || form.travelShockMm) && (
                  <p className="text-sm text-muted mt-1">
                    {form.travelForkMm && `Fork: ${form.travelForkMm}mm`}
                    {form.travelForkMm && form.travelShockMm && ' / '}
                    {form.travelShockMm && `Shock: ${form.travelShockMm}mm`}
                  </p>
                )}
                {form.category && (
                  <p className="text-xs text-muted mt-1 capitalize">{form.category}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowManualEntry(true)}
              className="text-xs text-primary hover:underline mt-2"
            >
              Edit details manually
            </button>
          </div>
        )}

        {/* Manual entry toggle */}
        {!form.manufacturer && !showManualEntry && (
          <button
            type="button"
            onClick={() => setShowManualEntry(true)}
            className="text-sm text-muted hover:text-primary"
          >
            Can't find your bike? Enter details manually
          </button>
        )}

        {/* Manual Entry Fields */}
        {showManualEntry && (
          <div className="space-y-4 border-t border-app pt-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted">Manual Entry</p>
              {form.spokesId && (
                <button
                  type="button"
                  onClick={() => setShowManualEntry(false)}
                  className="text-xs text-primary hover:underline"
                >
                  Use search result
                </button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Manufacturer"
                value={form.manufacturer}
                onChange={(e) => setField('manufacturer', e.target.value)}
                placeholder="Trek, Specialized, etc."
                required
              />
              <Input
                label="Model"
                value={form.model}
                onChange={(e) => setField('model', e.target.value)}
                placeholder="Slash, Enduro, etc."
                required
              />
              <Input
                label="Year"
                type="number"
                value={form.year}
                onChange={(e) => setField('year', e.target.value)}
                min={1990}
                max={new Date().getFullYear() + 1}
                required
              />
              <Input
                label="Fork Travel (mm)"
                type="number"
                value={form.travelForkMm}
                onChange={(e) => setField('travelForkMm', e.target.value)}
                placeholder="160"
                min={0}
              />
              <Input
                label="Shock Travel (mm)"
                type="number"
                value={form.travelShockMm}
                onChange={(e) => setField('travelShockMm', e.target.value)}
                placeholder="150"
                min={0}
              />
            </div>
          </div>
        )}

        {/* Nickname */}
        <Input
          label="Nickname (optional)"
          value={form.nickname}
          onChange={(e) => setField('nickname', e.target.value)}
          placeholder="Lunch laps rig"
        />

        {/* Bike Notes */}
        <Textarea
          label="Bike Notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          placeholder="Setup notes, service reminders..."
        />

        {error && (
          <div className="text-sm text-danger">{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canContinue}
            onClick={handleContinue}
          >
            Continue to Components
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: Component Review
  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-app rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-primary hover:underline mb-1"
          >
            ← Back
          </button>
          <h2 className="text-lg font-semibold text-heading">
            Review Components
          </h2>
          <p className="text-sm text-muted">
            {form.year} {form.manufacturer} {form.model}
          </p>
        </div>
        <span className="text-xs text-muted">Step 2 of 2</span>
      </div>

      <p className="text-sm text-muted">
        Review your bike's components. Edit any parts you've customized.
      </p>

      <div className="border border-app rounded-lg bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-app bg-surface-2">
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2 w-1/3">
                Component
              </th>
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2">
                Part
              </th>
            </tr>
          </thead>
          <tbody>
            {componentEntries.map((entry, idx) => (
              <tr
                key={entry.key}
                className={idx < componentEntries.length - 1 ? 'border-b border-app' : ''}
              >
                <td className="px-4 py-2 text-sm text-heading font-medium">
                  {entry.label}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(e) => updateComponentEntry(entry.key, e.target.value)}
                    placeholder="Brand Model"
                    className="w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="text-sm text-danger">{error}</div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={submitting}
        >
          {submitting ? 'Saving...' : mode === 'edit' ? 'Update Bike' : 'Create Bike'}
        </Button>
      </div>
    </form>
  );
}
