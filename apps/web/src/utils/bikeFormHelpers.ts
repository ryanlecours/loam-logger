/**
 * Shared utilities for bike form components (BikeForm.tsx and Onboarding.tsx).
 * Centralizes component entry building, validation, and GraphQL input conversion.
 */

import { ALL_COMPONENT_TYPES } from '@loam/shared';
import type { SpokesComponentEntry, SpokesBikeDetails } from '@/hooks/useSpokes';
import type { BikeFormValues, SpokesComponentData } from '@/models/BikeComponents';

/**
 * Component entry for bike forms - represents a single component with
 * brand/model and optional dimension fields.
 */
export type ComponentEntry = {
  key: string;
  label: string;
  brand: string;
  model: string;
  description: string;
  kind?: string;
  // Dimension fields
  travelMm?: number;    // Fork/shock travel
  offsetMm?: number;    // Fork offset (rake)
  lengthMm?: number;    // Stem length
  widthMm?: number;     // Handlebar width
};

/**
 * Converts a 99spokes component to GraphQL-allowed SpokesComponentInput fields.
 */
export const toSpokesInput = (
  comp: SpokesComponentEntry | null | undefined
): SpokesComponentData | null => {
  if (!comp) return null;
  return {
    maker: comp.make || comp.maker || null,
    model: comp.model || null,
    description: comp.description || null,
    kind: comp.kind || null,
  };
};

/**
 * Builds component entries from 99spokes bike details.
 * Used when selecting a bike from search.
 *
 * @param details - 99spokes bike details (or null for empty entries)
 * @param selectedSize - Optional frame size to use for geometry values
 */
export const buildComponentEntries = (
  details: SpokesBikeDetails | null,
  selectedSize?: string
): ComponentEntry[] => {
  // Get geometry from selected size or first available
  const sizeData = selectedSize
    ? details?.sizes?.find(s => s.name === selectedSize)
    : details?.sizes?.[0];
  const geometry = sizeData?.geometry?.source || sizeData?.geometry?.computed;

  return ALL_COMPONENT_TYPES.map(({ key, label, spokesKey }) => {
    let brand = '';
    let model = '';
    let description = '';
    let kind: string | undefined;
    let travelMm: number | undefined;
    let offsetMm: number | undefined;
    let lengthMm: number | undefined;
    let widthMm: number | undefined;

    if (details?.components && spokesKey) {
      const comp = details.components[spokesKey as keyof typeof details.components] as SpokesComponentEntry | undefined;
      if (comp) {
        brand = comp.make || comp.maker || '';
        model = comp.model || '';
        description = comp.description || '';
        kind = comp.kind;
      }
    }

    // Special handling for suspension components - prefer suspension object data
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

    // Add dimension data based on component type
    // Use nullish coalescing (??) to preserve valid zero values
    if (key === 'fork') {
      travelMm = details?.suspension?.front?.travelMM ?? details?.suspension?.front?.travel;
      offsetMm = geometry?.rakeMM ?? undefined;
    }
    if (key === 'rearShock') {
      travelMm = details?.suspension?.rear?.travelMM ?? details?.suspension?.rear?.travel;
    }
    if (key === 'stem') {
      lengthMm = geometry?.stemLengthMM ?? undefined;
    }
    if (key === 'handlebar') {
      widthMm = geometry?.handlebarWidthMM ?? undefined;
    }

    // Update label for dropper posts
    const displayLabel = key === 'seatpost' && kind === 'dropper' ? 'Dropper Post' : label;

    return {
      key,
      label: displayLabel,
      brand,
      model,
      description,
      kind,
      travelMm,
      offsetMm,
      lengthMm,
      widthMm,
    };
  });
};

/**
 * Builds component entries from existing bike form values (edit mode).
 * Maps legacy component keys to new format.
 */
export const buildComponentEntriesFromExisting = (initial: BikeFormValues): ComponentEntry[] => {
  // Map from new keys to legacy BIKE_COMPONENT_SECTIONS keys
  const legacyKeyMap: Record<string, string> = {
    fork: 'fork',
    rearShock: 'shock',
    wheels: 'wheels',
    pivotBearings: 'pivotBearings',
    seatpost: 'dropper', // dropper was the legacy key
  };

  return ALL_COMPONENT_TYPES.map(({ key, label }) => {
    const legacyKey = legacyKeyMap[key];
    const existingComp = legacyKey ? initial.components[legacyKey as keyof typeof initial.components] : undefined;

    return {
      key,
      label,
      brand: existingComp?.brand || '',
      model: existingComp?.model || '',
      description: '',
      // Dimensions from form travel fields
      travelMm: key === 'fork' && initial.travelForkMm ? parseInt(initial.travelForkMm) :
                key === 'rearShock' && initial.travelShockMm ? parseInt(initial.travelShockMm) : undefined,
    };
  });
};

/**
 * Validates a single component entry.
 * Returns error message if invalid, null if valid.
 * Rule: If either brand or model is filled, both must be filled.
 */
export const validateComponentEntry = (entry: ComponentEntry): string | null => {
  // Empty is OK (stock/default component)
  if (!entry.brand.trim() && !entry.model.trim()) return null;
  // Must have both brand and model if either is filled
  if (!entry.brand.trim()) return 'Brand required';
  if (!entry.model.trim()) return 'Model required';
  return null;
};

/**
 * Validates all component entries.
 * Returns a map of entry key -> error message for invalid entries.
 */
export const validateAllComponents = (entries: ComponentEntry[]): Record<string, string> => {
  const errors: Record<string, string> = {};
  entries.forEach((entry) => {
    const err = validateComponentEntry(entry);
    if (err) errors[entry.key] = err;
  });
  return errors;
};

/** Maximum dimension in mm (220mm - brake rotors are 220mm, everything else is <220mm) */
const MAX_DIMENSION_MM = 220;

/**
 * Parses a numeric input value with NaN and range validation.
 * Returns the parsed number or undefined if invalid or out of range.
 */
export const parseNumericInput = (
  value: string | number,
  min = 0,
  max = MAX_DIMENSION_MM
): number | undefined => {
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  if (Number.isNaN(num) || num < min || num > max) return undefined;
  return num;
};

/**
 * Validates that a URL is safe for use in img src attributes.
 * Only allows http/https protocols to prevent XSS via javascript: or data: URLs.
 */
export const isValidImageUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Filters spokesComponents to only include non-null entries.
 * Reduces payload size when sending to the backend.
 */
export const filterNonNullComponents = (
  components: Record<string, SpokesComponentData | null> | null | undefined
): Record<string, SpokesComponentData> | null => {
  if (!components) return null;

  const filtered = Object.entries(components).reduce((acc, [key, value]) => {
    if (value !== null && value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, SpokesComponentData>);

  // Return null if all components were null
  return Object.keys(filtered).length > 0 ? filtered : null;
};
