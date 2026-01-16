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
 */
export const buildComponentEntries = (
  details: SpokesBikeDetails | null
): ComponentEntry[] => {
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

    // Update label for dropper posts
    const displayLabel = key === 'seatpost' && kind === 'dropper' ? 'Dropper Post' : label;

    return {
      key,
      label: displayLabel,
      brand,
      model,
      description,
      kind,
      travelMm: undefined,
      offsetMm: undefined,
      lengthMm: undefined,
      widthMm: undefined,
    };
  });
};

/**
 * Builds component entries from existing bike form values (edit mode).
 * Maps component keys to form data, handling legacy key differences.
 */
export const buildComponentEntriesFromExisting = (initial: BikeFormValues): ComponentEntry[] => {
  // Map from ALL_COMPONENT_TYPES keys to BikeFormValues.components keys
  // Most keys match directly, these are the exceptions:
  const keyMap: Record<string, string> = {
    rearShock: 'shock',  // ALL_COMPONENT_TYPES uses 'rearShock', form uses 'shock'
  };

  return ALL_COMPONENT_TYPES.map(({ key, label }) => {
    // Use mapped key if exists, otherwise use key directly
    const formKey = keyMap[key] || key;
    const existingComp = initial.components[formKey as keyof typeof initial.components];

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

/** Component-specific dimension limits in mm */
const DIMENSION_LIMITS: Record<string, number> = {
  travelMm: 220,      // Fork/shock travel (max ~220mm for DH bikes)
  offsetMm: 100,      // Fork offset (typically 37-51mm, max ~65mm)
  lengthMm: 150,      // Stem length (typically 35-80mm, max ~150mm)
  widthMm: 850,       // Handlebar width (typically 760-800mm)
  default: 220,       // Fallback for unknown fields
};

/**
 * Gets the maximum allowed value for a dimension field.
 */
export const getDimensionLimit = (field: string): number => {
  return DIMENSION_LIMITS[field] ?? DIMENSION_LIMITS.default;
};

/**
 * Parses a numeric input value with strict validation.
 * Returns the parsed number or undefined if invalid or out of range.
 * Unlike parseInt, this rejects strings with trailing non-numeric characters
 * (e.g., "123abc" returns undefined instead of 123).
 */
export const parseNumericInput = (
  value: string | number,
  min = 0,
  max = DIMENSION_LIMITS.default
): number | undefined => {
  if (typeof value === 'number') {
    if (Number.isNaN(value) || value < min || value > max) return undefined;
    return value;
  }
  // Strict parsing: reject strings with non-numeric characters
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const num = parseInt(trimmed, 10);
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
