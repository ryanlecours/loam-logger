// What the ride edit form shows for each stored metric: a rounded,
// unit-converted copy. The form sends a metric back only when its input
// differs from what these produced on open, so a notes-only save cannot
// replace a provider's 8,368.4 m with the 5.2 mi the field displayed. That
// makes these the contract: a change in rounding here would make every
// untouched field read as edited.

export type DistanceUnit = 'mi' | 'km';

export const toDistanceInput = (meters: number, unit: DistanceUnit): number =>
  unit === 'km' ? Number((meters / 1000).toFixed(1)) : Number((meters / 1609.344).toFixed(1));

export const toElevationInput = (meters: number, unit: DistanceUnit): number =>
  Math.round(unit === 'km' ? meters : meters * 3.28084);

// Blank means "no descent on record", which is a real state the save
// preserves as null; it is not the same as 0.
export const toDescentInput = (meters: number | null | undefined, unit: DistanceUnit): number | '' =>
  meters == null ? '' : toElevationInput(meters, unit);
