import React, { useCallback, useEffect, useState, useRef, memo } from 'react';
import { type BikeFormProps, type BikeFormValues } from '@/models/BikeComponents';
import { Input, Textarea, Button } from './ui';
import { BikeSearch, type SpokesSearchResult } from './BikeSearch';
import { BikeImageSelector } from './BikeImageSelector';
import { useSpokes, type SpokesBikeDetails } from '@/hooks/useSpokes';
import { FaPencilAlt } from 'react-icons/fa';
import {
  type ComponentEntry,
  toSpokesInput,
  buildComponentEntries,
  buildComponentEntriesFromExisting,
  validateComponentEntry,
  parseNumericInput,
  getDimensionLimit,
  isValidImageUrl,
  filterNonNullComponents,
} from '@/utils/bikeFormHelpers';
import { WearStartStep } from './WearStartStep';
import { parseTravelFromDescription, type AcquisitionCondition } from '@loam/shared';

/**
 * Props for ComponentRow - memoized to prevent re-renders on sibling changes
 * Used only in edit mode for component review
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
 * Used only in edit mode.
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
            className={`w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none ${error && !entry.brand.trim() ? 'text-danger placeholder:text-danger/50' : ''}`}
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
            className={`w-full bg-transparent text-sm text-heading placeholder:text-muted/50 focus:outline-none ${error && !entry.model.trim() ? 'text-danger placeholder:text-danger/50' : ''}`}
          />
          <FaPencilAlt className="w-3 h-3 text-muted/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        {error && (
          <span className="text-xs text-danger">{error}</span>
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
  // Create mode: 2-3 steps (Bike Selection → [Colorway if multiple] → Wear Start Point)
  // Edit mode: Direct component editing (step 4)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(mode === 'edit' ? 4 : 1);
  const [form, setForm] = useState<BikeFormValues>(initial);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [spokesDetails, setSpokesDetails] = useState<SpokesBikeDetails | null>(null);
  const [acquisitionCondition, setAcquisitionCondition] = useState<AcquisitionCondition | null>(
    initial.acquisitionCondition ?? (mode === 'create' ? 'NEW' : null)
  );

  // Edit mode only - component entries and validation
  const [componentEntries, setComponentEntries] = useState<ComponentEntry[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { getBikeDetails, isLoading: loadingDetails } = useSpokes();

  // Determine if we have multiple images for colorway selection
  const hasMultipleImages = (spokesDetails?.images?.length ?? 0) > 1;
  // Total steps: 2 if no colorway choice, 3 if colorway choice exists
  const totalSteps = hasMultipleImages ? 3 : 2;

  // Get bike image URL with fallback to images array, validated for security
  const getBikeImageUrl = () => {
    const url = form.thumbnailUrl || spokesDetails?.images?.[0]?.url;
    return url && isValidImageUrl(url) ? url : null;
  };

  // Handle image selection from BikeImageSelector
  const handleImageSelect = (url: string) => {
    setForm((prev) => ({ ...prev, thumbnailUrl: url }));
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

  // Cleanup validation timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      clearTimeout(validationTimerRef.current ?? undefined);
    };
  }, []);

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

      // Parse travel from component descriptions if not directly available
      const forkTravel = parseTravelFromDescription(details.components?.fork?.description);
      const shockTravel = parseTravelFromDescription(
        details.components?.rearShock?.description || details.components?.shock?.description
      );

      // Prioritize images array over thumbnailUrl
      const defaultImage = details.images?.[0]?.url || details.thumbnailUrl || null;

      setForm((prev) => ({
        ...prev,
        spokesUrl: details.url || null,
        thumbnailUrl: defaultImage,
        family: details.family || prev.family,
        category: details.category || prev.category,
        subcategory: details.subcategory || prev.subcategory,
        buildKind: details.buildKind || null,
        isFrameset: details.isFrameset ?? false,
        isEbike: details.isEbike ?? false,
        gender: details.gender || null,
        frameMaterial: details.frameMaterial || null,
        hangerStandard: details.hangerStandard || null,
        travelForkMm: forkTravel ? String(forkTravel) : prev.travelForkMm,
        travelShockMm: shockTravel ? String(shockTravel) : prev.travelShockMm,
        motorMaker: details.isEbike && details.components?.motor?.maker ? details.components.motor.maker : null,
        motorModel: details.isEbike && details.components?.motor?.model ? details.components.motor.model : null,
        motorPowerW: details.isEbike && details.components?.motor?.powerW ? details.components.motor.powerW : null,
        motorTorqueNm: details.isEbike && details.components?.motor?.torqueNm ? details.components.motor.torqueNm : null,
        batteryWh: details.isEbike && details.components?.battery?.capacityWh ? details.components.battery.capacityWh : null,
      }));

      // For edit mode, build component entries
      if (mode === 'edit') {
        setComponentEntries(buildComponentEntries(details));
      }
    }

    // Default to "Start Fresh" for 99Spokes bikes in create mode (only if not already set)
    if (mode === 'create' && !acquisitionCondition) {
      setAcquisitionCondition('NEW');
    }
  };

  // Proceed from Step 1 to Step 2 (Colorway if multiple images, otherwise Wear Start)
  const handleContinueFromStep1 = () => {
    // Default to NEW if not set
    if (!acquisitionCondition) {
      setAcquisitionCondition('NEW');
    }
    setStep(2);
  };

  // Proceed from Step 2 (Colorway) to Step 3 (Wear Start)
  const handleContinueFromColorway = () => {
    setStep(3);
  };

  // Go back handlers
  const handleBackToStep1 = () => {
    setStep(1);
  };

  const handleBackToStep2 = () => {
    setStep(2);
  };

  // Build spokesComponents from 99Spokes details
  const buildSpokesComponents = () => {
    if (!spokesDetails?.components) return null;
    return {
      fork: toSpokesInput(spokesDetails.components.fork),
      rearShock: toSpokesInput(spokesDetails.components.rearShock || spokesDetails.components.shock),
      brakes: toSpokesInput(spokesDetails.components.brakes),
      rearDerailleur: toSpokesInput(spokesDetails.components.rearDerailleur),
      crank: toSpokesInput(spokesDetails.components.crank),
      cassette: toSpokesInput(spokesDetails.components.cassette),
      wheels: toSpokesInput(spokesDetails.components.wheels),
      rims: toSpokesInput(spokesDetails.components.rims),
      tires: toSpokesInput(spokesDetails.components.tires),
      stem: toSpokesInput(spokesDetails.components.stem),
      handlebar: toSpokesInput(spokesDetails.components.handlebar),
      saddle: toSpokesInput(spokesDetails.components.saddle),
      seatpost: spokesDetails.components.seatpost ? {
        ...toSpokesInput(spokesDetails.components.seatpost),
        kind: spokesDetails.components.seatpost.kind || null,
      } : null,
      chain: toSpokesInput(spokesDetails.components.chain),
      headset: toSpokesInput(spokesDetails.components.headset),
      bottomBracket: toSpokesInput(spokesDetails.components.bottomBracket),
      discRotors: toSpokesInput(spokesDetails.components.discRotors),
    };
  };

  // Submit handler for create mode (called from Step 2)
  const handleCreateSubmit = () => {
    const spokesComponents = buildSpokesComponents();

    const finalForm: BikeFormValues = {
      ...form,
      acquisitionCondition: acquisitionCondition ?? 'NEW',
      spokesComponents: filterNonNullComponents(spokesComponents),
      // Default component state - backend will create actual components
      components: {
        brakes: { brand: '', model: '', notes: '', isStock: true },
        cassette: { brand: '', model: '', notes: '', isStock: true },
        chain: { brand: '', model: '', notes: '', isStock: true },
        rims: { brand: '', model: '', notes: '', isStock: true },
        tires: { brand: '', model: '', notes: '', isStock: true },
        stem: { brand: '', model: '', notes: '', isStock: true },
        handlebar: { brand: '', model: '', notes: '', isStock: true },
        saddle: { brand: '', model: '', notes: '', isStock: true },
        rearDerailleur: { brand: '', model: '', notes: '', isStock: true },
        crank: { brand: '', model: '', notes: '', isStock: true },
        fork: { brand: '', model: '', notes: '', isStock: true },
        shock: { brand: '', model: '', notes: '', isStock: true },
        wheels: { brand: '', model: '', notes: '', isStock: true },
        pivotBearings: { brand: '', model: '', notes: '', isStock: true },
        frame: { brand: '', model: '', notes: '', isStock: true },
        seatpost: { brand: '', model: '', notes: '', isStock: true },
      },
    };

    onSubmit(finalForm);
  };

  // ============================================================================
  // Edit Mode Only - Component management
  // ============================================================================

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
        return { ...entry, [field]: parseNumericInput(value, 0, getDimensionLimit(field)) };
      })
    );
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      setComponentEntries((current) => {
        const entry = current.find((e) => e.key === key);
        if (entry) {
          const err = validateComponentEntry(entry);
          if (err) {
            setErrors((prev) => ({ ...prev, [key]: err }));
          }
        }
        return current;
      });
    }, 300);
  }, []);

  // Validate all components (edit mode only)
  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {};
    componentEntries.forEach((entry) => {
      const err = validateComponentEntry(entry);
      if (err) newErrors[entry.key] = err;
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit handler for edit mode
  const handleEditSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();

    if (!validateAll()) {
      return;
    }

    const spokesComponents = buildSpokesComponents();

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

    const seatpostEntry = componentEntries.find((e) => e.key === 'seatpost');
    const isDropper = seatpostEntry?.kind === 'dropper';
    const forkEntry = componentEntries.find((e) => e.key === 'fork');
    const shockEntry = componentEntries.find((e) => e.key === 'rearShock');

    const finalForm: BikeFormValues = {
      ...form,
      travelForkMm: forkEntry?.travelMm ? String(forkEntry.travelMm) : form.travelForkMm,
      travelShockMm: shockEntry?.travelMm ? String(shockEntry.travelMm) : form.travelShockMm,
      acquisitionCondition: acquisitionCondition ?? 'USED',
      spokesComponents: filterNonNullComponents(spokesComponents),
      components: {
        brakes: getComponentData('brakes'),
        cassette: getComponentData('cassette'),
        chain: getComponentData('chain'),
        rims: getComponentData('rims'),
        tires: getComponentData('tires'),
        stem: getComponentData('stem'),
        handlebar: getComponentData('handlebar'),
        saddle: getComponentData('saddle'),
        rearDerailleur: getComponentData('rearDerailleur'),
        crank: getComponentData('crank'),
        fork: getComponentData('fork'),
        shock: getComponentData('rearShock'),
        wheels: getComponentData('wheels'),
        pivotBearings: getComponentData('pivotBearings'),
        frame: getComponentData('frame'),
        seatpost: isDropper ? getComponentData('seatpost') : { brand: '', model: '', notes: '', isStock: true },
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

  // ============================================================================
  // Step 1: Bike Selection (Create & Edit modes)
  // ============================================================================
  if (step === 1) {
    return (
      <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">
            {mode === 'edit' ? 'Edit Bike' : 'Add New Bike'}
          </h2>
          <span className="text-xs text-muted">Step 1 of {totalSteps}</span>
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
            onClick={handleContinueFromStep1}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Step 2: Colorway Selection (Create mode, only if multiple images)
  // OR Wear Start Point (Create mode, if no multiple images)
  // ============================================================================
  if (step === 2 && mode === 'create') {
    // If multiple images, show colorway selector
    if (hasMultipleImages) {
      return (
        <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-primary">
                Which colorway do you have?
              </h2>
              <p className="text-sm text-muted mt-1">
                Select the color that matches your bike.
              </p>
            </div>
            <span className="text-xs text-muted">Step 2 of {totalSteps}</span>
          </div>

          <BikeImageSelector
            images={spokesDetails!.images!}
            thumbnailUrl={spokesDetails!.thumbnailUrl}
            selectedUrl={form.thumbnailUrl ?? null}
            onSelect={handleImageSelect}
          />

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={handleBackToStep1}
              className="px-4 py-2 text-sm font-medium text-muted hover:text-primary transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleContinueFromColorway}
              className="px-6 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      );
    }

    // No multiple images, show wear start directly as Step 2
    return (
      <WearStartStep
        selected={acquisitionCondition}
        onSelect={setAcquisitionCondition}
        onBack={handleBackToStep1}
        onSubmit={handleCreateSubmit}
        submitting={submitting}
      />
    );
  }

  // ============================================================================
  // Step 3: Wear Start Point (Create mode, only after colorway selection)
  // ============================================================================
  if (step === 3 && mode === 'create') {
    return (
      <WearStartStep
        selected={acquisitionCondition}
        onSelect={setAcquisitionCondition}
        onBack={handleBackToStep2}
        onSubmit={handleCreateSubmit}
        submitting={submitting}
      />
    );
  }

  // ============================================================================
  // Step 4: Component Review (Edit mode only)
  // ============================================================================
  const isNewBike = acquisitionCondition === 'NEW';

  return (
    <form onSubmit={handleEditSubmit} className="bg-surface border border-app rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-heading">
            Edit Bike
          </h2>
          <p className="text-sm text-muted">
            {form.year} {form.manufacturer} {form.model}
          </p>
        </div>
      </div>

      {/* NEW bike confirmation banner */}
      {isNewBike && (
        <div className="alert alert-success">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <div>
              <p className="text-sm font-medium">
                All components set to "Just serviced"
              </p>
              <p className="text-xs text-muted mt-0.5">
                Since this is a brand new bike, all components start fresh with no wear.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* USED/MIXED bike info */}
      {!isNewBike && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔧</span>
            <div>
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Components have wear tracking enabled
              </p>
              <p className="text-xs text-muted mt-0.5">
                You can adjust individual component wear from the bike detail page.
              </p>
            </div>
          </div>
        </div>
      )}

      <p className="text-sm text-muted">
        Review and edit your bike's component details.
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
          {submitting ? 'Saving...' : 'Update Bike'}
        </Button>
      </div>
    </form>
  );
}
