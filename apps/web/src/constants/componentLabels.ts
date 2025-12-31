/**
 * Human-readable labels for bike component types.
 * Used throughout the dashboard and maintenance UI.
 */
export const COMPONENT_LABELS: Record<string, string> = {
  FORK: 'Fork',
  SHOCK: 'Shock',
  BRAKES: 'Brakes',
  DRIVETRAIN: 'Drivetrain',
  TIRES: 'Tires',
  CHAIN: 'Chain',
  CASSETTE: 'Cassette',
  CHAINRING: 'Chainring',
  WHEELS: 'Wheels',
  DROPPER: 'Dropper',
  PIVOT_BEARINGS: 'Pivot Bearings',
  BRAKE_PAD: 'Brake Pads',
  BRAKE_ROTOR: 'Brake Rotor',
  HEADSET: 'Headset',
  BOTTOM_BRACKET: 'Bottom Bracket',
};

/**
 * Get human-readable label for a component type.
 * Falls back to the raw type if no label is defined.
 */
export function getComponentLabel(componentType: string): string {
  return COMPONENT_LABELS[componentType] ?? componentType;
}
