/**
 * Component Catalog - Single source of truth for component definitions
 *
 * This file defines all component types, their service intervals, and applicability rules.
 * Component creation logic should ONLY use this catalog to determine which components
 * to create for a given bike.
 */

// ============================================================================
// Types
// ============================================================================

export interface BikeSpec {
  hasFrontSuspension: boolean;
  hasRearSuspension: boolean;
  brakeType?: 'disc' | 'rim';
  drivetrainType?: '1x' | '2x' | '3x';
}

export type ComponentCategory =
  | 'SUSPENSION'
  | 'DRIVETRAIN'
  | 'BRAKES'
  | 'WHEELS'
  | 'COCKPIT'
  | 'FRAME';

export interface ComponentDefinition {
  /** Database ComponentType enum value */
  type: string;
  /** Human-readable display name */
  displayName: string;
  /** Category for grouping in UI */
  category: ComponentCategory;
  /** Default service interval in hours */
  serviceIntervalHours: number;
  /** Default baseline wear percent for USED/MIXED bikes (0-100) */
  defaultBaselineWearPercent: number;
  /** Function to determine if this component applies to a given bike */
  isApplicable: (spec: BikeSpec) => boolean;
  /** Whether this component supports FRONT/REAR location */
  supportsLocation?: boolean;
  /** Whether this component REQUIRES front/rear pairing (creates pairs on import) */
  requiresPairing?: boolean;
  /** 99Spokes API key for this component (null if not available from 99Spokes) */
  spokesKey?: string | null;
}

/**
 * Component types that require front/rear pairing.
 * When importing a bike, these will create two components (FRONT + REAR).
 */
export const PAIRED_COMPONENT_TYPES = ['TIRES', 'BRAKE_PAD', 'BRAKE_ROTOR', 'BRAKES'] as const;
export type PairedComponentType = (typeof PAIRED_COMPONENT_TYPES)[number];

// ============================================================================
// Component Catalog - THE SINGLE SOURCE OF TRUTH
// ============================================================================

export const COMPONENT_CATALOG: ComponentDefinition[] = [
  // ---------------------------------------------------------------------------
  // SUSPENSION
  // ---------------------------------------------------------------------------
  {
    type: 'FORK',
    displayName: 'Fork',
    category: 'SUSPENSION',
    serviceIntervalHours: 50,
    defaultBaselineWearPercent: 50,
    isApplicable: (spec) => spec.hasFrontSuspension,
    spokesKey: 'fork',
  },
  {
    type: 'SHOCK',
    displayName: 'Rear Shock',
    category: 'SUSPENSION',
    serviceIntervalHours: 50,
    defaultBaselineWearPercent: 50,
    isApplicable: (spec) => spec.hasRearSuspension,
    spokesKey: 'rearShock',
  },

  // ---------------------------------------------------------------------------
  // DRIVETRAIN
  // ---------------------------------------------------------------------------
  {
    type: 'CHAIN',
    displayName: 'Chain',
    category: 'DRIVETRAIN',
    serviceIntervalHours: 70,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'chain',
  },
  {
    type: 'CASSETTE',
    displayName: 'Cassette',
    category: 'DRIVETRAIN',
    serviceIntervalHours: 200,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'cassette',
  },
  {
    type: 'CRANK',
    displayName: 'Crankset',
    category: 'DRIVETRAIN',
    serviceIntervalHours: 500,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'crank',
  },
  {
    type: 'REAR_DERAILLEUR',
    displayName: 'Rear Derailleur',
    category: 'DRIVETRAIN',
    serviceIntervalHours: 200, // cable/housing replacement
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'rearDerailleur',
  },
  {
    type: 'DRIVETRAIN',
    displayName: 'Drivetrain Clean/Lube',
    category: 'DRIVETRAIN',
    serviceIntervalHours: 6,
    defaultBaselineWearPercent: 0, // resets after each service
    isApplicable: () => true,
  },

  // ---------------------------------------------------------------------------
  // BRAKES
  // ---------------------------------------------------------------------------
  {
    type: 'BRAKES',
    displayName: 'Brake Fluid',
    category: 'BRAKES',
    serviceIntervalHours: 100,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    supportsLocation: true,
    requiresPairing: true,
    spokesKey: 'brakes',
  },
  {
    type: 'BRAKE_PAD',
    displayName: 'Brake Pads',
    category: 'BRAKES',
    serviceIntervalHours: 40,
    defaultBaselineWearPercent: 50,
    isApplicable: (spec) => spec.brakeType === 'disc',
    supportsLocation: true,
    requiresPairing: true,
  },
  {
    type: 'BRAKE_ROTOR',
    displayName: 'Brake Rotors',
    category: 'BRAKES',
    serviceIntervalHours: 200,
    defaultBaselineWearPercent: 50,
    isApplicable: (spec) => spec.brakeType === 'disc',
    supportsLocation: true,
    requiresPairing: true,
    spokesKey: 'discRotors',
  },

  // ---------------------------------------------------------------------------
  // WHEELS
  // ---------------------------------------------------------------------------
  {
    type: 'WHEEL_HUBS',
    displayName: 'Wheel Hubs',
    category: 'WHEELS',
    serviceIntervalHours: 250,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'wheels', // keep spokesKey for 99spokes import compatibility
  },
  {
    type: 'RIMS',
    displayName: 'Rims',
    category: 'WHEELS',
    serviceIntervalHours: 500,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'rims',
  },
  {
    type: 'TIRES',
    displayName: 'Tires',
    category: 'WHEELS',
    serviceIntervalHours: 120,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    supportsLocation: true,
    requiresPairing: true,
    spokesKey: 'tires',
  },

  // ---------------------------------------------------------------------------
  // COCKPIT
  // ---------------------------------------------------------------------------
  {
    type: 'STEM',
    displayName: 'Stem',
    category: 'COCKPIT',
    serviceIntervalHours: 1000,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'stem',
  },
  {
    type: 'HANDLEBAR',
    displayName: 'Handlebar',
    category: 'COCKPIT',
    serviceIntervalHours: 1000,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'handlebar',
  },
  {
    type: 'SADDLE',
    displayName: 'Saddle',
    category: 'COCKPIT',
    serviceIntervalHours: 1000,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'saddle',
  },
  {
    type: 'SEATPOST',
    displayName: 'Seatpost',
    category: 'COCKPIT',
    serviceIntervalHours: 500,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'seatpost',
  },
  {
    type: 'DROPPER',
    displayName: 'Dropper Post',
    category: 'COCKPIT',
    serviceIntervalHours: 150,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
  },

  // ---------------------------------------------------------------------------
  // FRAME
  // ---------------------------------------------------------------------------
  {
    type: 'PIVOT_BEARINGS',
    displayName: 'Pivot Bearings',
    category: 'FRAME',
    serviceIntervalHours: 250,
    defaultBaselineWearPercent: 50,
    isApplicable: (spec) => spec.hasRearSuspension,
  },
  {
    type: 'HEADSET',
    displayName: 'Headset',
    category: 'FRAME',
    serviceIntervalHours: 250,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'headset',
  },
  {
    type: 'BOTTOM_BRACKET',
    displayName: 'Bottom Bracket',
    category: 'FRAME',
    serviceIntervalHours: 250,
    defaultBaselineWearPercent: 50,
    isApplicable: () => true,
    spokesKey: 'bottomBracket',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all components that are applicable to a given bike specification.
 * This is the primary function used when creating components for a new bike.
 */
export function getApplicableComponents(spec: BikeSpec): ComponentDefinition[] {
  return COMPONENT_CATALOG.filter((c) => c.isApplicable(spec));
}

/**
 * Get a component definition by its type.
 */
export function getComponentByType(
  type: string
): ComponentDefinition | undefined {
  return COMPONENT_CATALOG.find((c) => c.type === type);
}

/**
 * Get all components in a specific category.
 */
export function getComponentsByCategory(
  category: ComponentCategory
): ComponentDefinition[] {
  return COMPONENT_CATALOG.filter((c) => c.category === category);
}

/**
 * Get the 99Spokes key to component type mapping.
 * Used when processing 99Spokes bike data.
 */
export function getSpokesKeyToTypeMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const component of COMPONENT_CATALOG) {
    if (component.spokesKey) {
      map[component.spokesKey] = component.type;
    }
  }
  return map;
}

/**
 * Get all unique categories in the catalog.
 */
export function getAllCategories(): ComponentCategory[] {
  const categories = new Set<ComponentCategory>();
  for (const component of COMPONENT_CATALOG) {
    categories.add(component.category);
  }
  return Array.from(categories);
}

/**
 * Check if a component type requires front/rear pairing.
 */
export function requiresPairing(type: string): boolean {
  const component = getComponentByType(type);
  return component?.requiresPairing === true;
}

/**
 * Get all component definitions that require front/rear pairing.
 */
export function getPairedComponentDefinitions(): ComponentDefinition[] {
  return COMPONENT_CATALOG.filter((c) => c.requiresPairing === true);
}

/**
 * Derive the slot key for a component type + location combination.
 * This is the canonical slot identifier used in BikeComponentInstall.
 * Examples: "FORK_NONE", "TIRES_FRONT", "BRAKES_REAR"
 */
export function getSlotKey(type: string, location: string): string {
  return `${type}_${location}`;
}

/**
 * Parse a slot key back into type and location.
 */
export function parseSlotKey(slotKey: string): { type: string; location: string } {
  const lastUnderscore = slotKey.lastIndexOf('_');
  return {
    type: slotKey.substring(0, lastUnderscore),
    location: slotKey.substring(lastUnderscore + 1),
  };
}
