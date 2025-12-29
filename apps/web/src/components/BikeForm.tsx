import React, { useCallback, useEffect, useState, memo } from 'react';
import { type BikeFormProps, type BikeFormValues } from '@/models/BikeComponents';
import { Input, Textarea, Button } from './ui';
import { BikeSearch, type SpokesSearchResult } from './BikeSearch';
import { useSpokes, type SpokesBikeDetails } from '@/hooks/useSpokes';
import { FaPencilAlt } from 'react-icons/fa';
import {
  type ComponentEntry,
  toSpokesInput,
  buildComponentEntries,
  buildComponentEntriesFromExisting,
  validateComponentEntry,
  parseNumericInput,
  isValidImageUrl,
  filterNonNullComponents,
} from '@/utils/bikeFormHelpers';

/**
 * Props for ComponentRow - memoized to prevent re-renders on sibling changes
 */
type ComponentRowProps = {
  entry: ComponentEntry;
  isLast: boolean;
  error?: string;
  onUpdate: (key: string, field: 'brand' | 'model' | 'travelMm' | 'offsetMm' | 'lengthMm' | 'widthMm', value: string | number) => void;
};

/**
 * Memoized component row to prevent expensive table re-renders.
 * Only re-renders when its specific entry, error, or isLast status changes.
 */
const ComponentRow = memo(function ComponentRow({ entry, isLast, error, onUpdate }: ComponentRowProps) {
  const hasTravelSpec = entry.key === 'fork' || entry.key === 'rearShock';
  const hasOffsetSpec = entry.key === 'fork';
  const hasLengthSpec = entry.key === 'stem';
  const hasWidthSpec = entry.key === 'handlebar';
  const hasAnySpec = hasTravelSpec || hasLengthSpec || hasWidthSpec;

  return (
    <tr
      className={`${!isLast ? 'border-b border-app' : ''} hover:bg-surface-2 transition-colors group`}
    >
      <td className="px-4 py-2 text-sm text-heading font-medium">
        {entry.label}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={entry.brand}
            onChange={(e) => onUpdate(entry.key, 'brand', e.target.value)}
            placeholder="Brand"
            className={`w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none ${error && !entry.brand.trim() ? 'text-red-400 placeholder:text-red-400/50' : ''}`}
          />
          <FaPencilAlt className="w-3 h-3 text-muted/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={entry.model}
            onChange={(e) => onUpdate(entry.key, 'model', e.target.value)}
            placeholder="Model"
            className={`w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none ${error && !entry.model.trim() ? 'text-red-400 placeholder:text-red-400/50' : ''}`}
          />
          <FaPencilAlt className="w-3 h-3 text-muted/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </td>
      <td className="px-4 py-2">
        {hasAnySpec && (
          <div className="flex items-center gap-2 text-sm">
            {hasTravelSpec && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={entry.travelMm ?? ''}
                  onChange={(e) => onUpdate(entry.key, 'travelMm', e.target.value)}
                  placeholder="—"
                  className="w-12 bg-transparent text-heading placeholder:text-muted/50 focus:outline-none text-center"
                  min={0}
                />
                <span className="text-muted text-xs">mm</span>
              </div>
            )}
            {hasOffsetSpec && (
              <div className="flex items-center gap-1 ml-2">
                <span className="text-muted text-xs">offset</span>
                <input
                  type="number"
                  value={entry.offsetMm ?? ''}
                  onChange={(e) => onUpdate(entry.key, 'offsetMm', e.target.value)}
                  placeholder="—"
                  className="w-10 bg-transparent text-heading placeholder:text-muted/50 focus:outline-none text-center"
                  min={0}
                />
                <span className="text-muted text-xs">mm</span>
              </div>
            )}
            {hasLengthSpec && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={entry.lengthMm ?? ''}
                  onChange={(e) => onUpdate(entry.key, 'lengthMm', e.target.value)}
                  placeholder="—"
                  className="w-12 bg-transparent text-heading placeholder:text-muted/50 focus:outline-none text-center"
                  min={0}
                />
                <span className="text-muted text-xs">mm</span>
              </div>
            )}
            {hasWidthSpec && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={entry.widthMm ?? ''}
                  onChange={(e) => onUpdate(entry.key, 'widthMm', e.target.value)}
                  placeholder="—"
                  className="w-12 bg-transparent text-heading placeholder:text-muted/50 focus:outline-none text-center"
                  min={0}
                />
                <span className="text-muted text-xs">mm</span>
              </div>
            )}
          </div>
        )}
        {entry.kind === 'dropper' && (
          <span className="text-xs text-muted italic">dropper</span>
        )}
      </td>
    </tr>
  );
});

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
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { getBikeDetails, isLoading: loadingDetails } = useSpokes();

  // Get available sizes from spokesDetails
  const availableSizes = spokesDetails?.sizes?.map(s => s.name) || [];

  // Get bike image URL with fallback to images array, validated for security
  const getBikeImageUrl = () => {
    const url = form.thumbnailUrl || spokesDetails?.images?.[0]?.url;
    return url && isValidImageUrl(url) ? url : null;
  };

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

  // Update a component entry field - memoized to prevent ComponentRow re-renders
  const updateComponentEntry = useCallback((
    key: string,
    field: 'brand' | 'model' | 'travelMm' | 'offsetMm' | 'lengthMm' | 'widthMm',
    value: string | number
  ) => {
    setComponentEntries((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry;
        if (field === 'brand' || field === 'model') {
          return { ...entry, [field]: value as string };
        }
        // Handle numeric dimension fields with NaN validation
        return { ...entry, [field]: parseNumericInput(value) };
      })
    );
    // Clear validation error when user edits (using functional form to avoid dependency on errors)
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Validate all components using shared utility
  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {};
    componentEntries.forEach((entry) => {
      const err = validateComponentEntry(entry);
      if (err) newErrors[entry.key] = err;
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle size selection - preserve user edits, only update dimensions from new size
  // Wrapped in useCallback to prevent unnecessary re-renders and ensure stable reference
  const handleSizeChange = useCallback((sizeName: string) => {
    setSelectedSize(sizeName || null);
    if (sizeName && spokesDetails) {
      const newEntries = buildComponentEntries(spokesDetails, sizeName);
      // Merge new size geometry with existing user edits
      setComponentEntries((prev) =>
        newEntries.map((newEntry) => {
          const existing = prev.find((e) => e.key === newEntry.key);
          if (!existing) return newEntry;
          // Preserve user's brand/model edits, update dimensions from new size
          return {
            ...newEntry,
            brand: existing.brand || newEntry.brand,
            model: existing.model || newEntry.model,
          };
        })
      );
    }
  }, [spokesDetails]);

  // Build final form data and submit
  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();

    // Validate before submit
    if (!validateAll()) {
      return;
    }

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
      if (!entry || (!entry.brand.trim() && !entry.model.trim())) {
        return { brand: '', model: '', notes: '', isStock: true };
      }
      return {
        brand: entry.brand.trim(),
        model: entry.model.trim(),
        notes: '',
        isStock: false,
      };
    };

    // Map our new keys to the legacy BIKE_COMPONENT_SECTIONS keys
    const seatpostEntry = componentEntries.find((e) => e.key === 'seatpost');
    const isDropper = seatpostEntry?.kind === 'dropper';

    // Travel fields: component table entries take precedence over form state.
    // This allows users to edit travel in the component table (Step 2) and have
    // those values persist to the bike record, overriding any auto-populated values.
    const forkEntry = componentEntries.find((e) => e.key === 'fork');
    const shockEntry = componentEntries.find((e) => e.key === 'rearShock');

    const finalForm: BikeFormValues = {
      ...form,
      travelForkMm: forkEntry?.travelMm ? String(forkEntry.travelMm) : form.travelForkMm,
      travelShockMm: shockEntry?.travelMm ? String(shockEntry.travelMm) : form.travelShockMm,
      selectedSize: selectedSize || undefined,
      spokesComponents: filterNonNullComponents(spokesComponents),
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
              {getBikeImageUrl() && (
                <img
                  src={getBikeImageUrl()!}
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

            {/* Size selector */}
            {availableSizes.length > 0 && (
              <div className="mt-4 pt-3 border-t border-app/50">
                <label className="text-sm text-muted block mb-1">Frame Size</label>
                <select
                  value={selectedSize || ''}
                  onChange={(e) => handleSizeChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface border border-app text-heading text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select size (optional)</option>
                  {availableSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-1">
                  Size selection updates component dimensions
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowManualEntry(true)}
              className="text-xs text-primary hover:underline mt-3"
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
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2 w-28">
                Component
              </th>
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2 w-32">
                Brand
              </th>
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2">
                Model
              </th>
              <th className="text-left text-xs font-medium text-muted uppercase tracking-wide px-4 py-2 w-40">
                Specs
              </th>
            </tr>
          </thead>
          <tbody>
            {componentEntries.map((entry, idx) => (
              <ComponentRow
                key={entry.key}
                entry={entry}
                isLast={idx === componentEntries.length - 1}
                error={errors[entry.key]}
                onUpdate={updateComponentEntry}
              />
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
