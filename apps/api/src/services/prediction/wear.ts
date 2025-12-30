import type { ComponentType } from '@prisma/client';
import type {
  RideMetrics,
  ComponentWearWeights,
  WearCalculationResult,
  WearDriver,
  WearFactor,
} from './types';
import { getComponentWeights } from './config';

/**
 * Calculate wear units for a single ride.
 *
 * Formula from spec:
 *   wearUnits = wH*H + wD*(D/10) + wC*(C/3000) + wV*(V/300)
 *   where V = elevationGainFt / max(distanceMiles, 1)
 *
 * @param ride - Ride metrics
 * @param weights - Component-specific weights
 * @returns Wear units for this ride
 */
export function calculateRideWear(
  ride: RideMetrics,
  weights: ComponentWearWeights
): number {
  const H = ride.durationSeconds / 3600; // hours
  const D = ride.distanceMiles;
  const C = ride.elevationGainFeet;
  const V = C / Math.max(D, 1); // ft per mile (steepness proxy)

  const wearUnits =
    weights.wH * H +
    weights.wD * (D / 10) +
    weights.wC * (C / 3000) +
    weights.wV * (V / 300);

  return Math.max(0, wearUnits);
}

/**
 * Calculate detailed wear breakdown for a set of rides.
 * Returns total wear and breakdown by factor.
 *
 * @param rides - Array of ride metrics
 * @param weights - Component-specific weights
 * @returns Wear calculation result with totals and breakdown
 */
export function calculateWearDetailed(
  rides: RideMetrics[],
  weights: ComponentWearWeights
): WearCalculationResult {
  let totalHours = 0;
  let hoursWear = 0;
  let distanceWear = 0;
  let climbingWear = 0;
  let steepnessWear = 0;

  for (const ride of rides) {
    const H = ride.durationSeconds / 3600;
    const D = ride.distanceMiles;
    const C = ride.elevationGainFeet;
    const V = C / Math.max(D, 1);

    totalHours += H;
    hoursWear += weights.wH * H;
    distanceWear += weights.wD * (D / 10);
    climbingWear += weights.wC * (C / 3000);
    steepnessWear += weights.wV * (V / 300);
  }

  const totalWearUnits = hoursWear + distanceWear + climbingWear + steepnessWear;

  return {
    totalWearUnits: Math.max(0, totalWearUnits),
    totalHours,
    breakdown: {
      hours: hoursWear,
      distance: distanceWear,
      climbing: climbingWear,
      steepness: steepnessWear,
    },
  };
}

/**
 * Calculate total wear units for a set of rides.
 *
 * @param rides - Array of ride metrics
 * @param weights - Component-specific weights
 * @returns Total wear units
 */
export function calculateTotalWear(
  rides: RideMetrics[],
  weights: ComponentWearWeights
): number {
  return rides.reduce((total, ride) => total + calculateRideWear(ride, weights), 0);
}

/**
 * Calculate total hours from rides.
 *
 * @param rides - Array of ride metrics
 * @returns Total hours
 */
export function calculateTotalHours(rides: RideMetrics[]): number {
  return rides.reduce((total, ride) => total + ride.durationSeconds / 3600, 0);
}

/**
 * Calculate wear-per-hour ratio for adaptive predictions.
 * Used by PRO tier for adaptive wear modeling.
 *
 * @param rides - Recent rides
 * @param componentType - Type of component
 * @returns Wear per hour ratio
 */
export function calculateWearPerHourRatio(
  rides: RideMetrics[],
  componentType: ComponentType
): number {
  if (rides.length === 0) {
    return 1.0; // Default ratio (baseline)
  }

  const weights = getComponentWeights(componentType);
  const { totalWearUnits, totalHours } = calculateWearDetailed(rides, weights);

  if (totalHours <= 0) {
    return 1.0;
  }

  // Ratio of actual wear to baseline wear (1 wear unit per hour)
  return totalWearUnits / totalHours;
}

/**
 * Generate wear drivers for explanation.
 * Converts breakdown into sorted, labeled drivers with percentage contributions.
 *
 * @param breakdown - Wear breakdown by factor
 * @returns Array of wear drivers sorted by contribution (highest first)
 */
export function generateWearDrivers(breakdown: {
  hours: number;
  distance: number;
  climbing: number;
  steepness: number;
}): WearDriver[] {
  const total =
    breakdown.hours + breakdown.distance + breakdown.climbing + breakdown.steepness;

  // Handle zero total wear (avoid division by zero)
  if (total <= 0) {
    return [
      { factor: 'hours', contribution: 25, label: 'Time in saddle' },
      { factor: 'distance', contribution: 25, label: 'Distance ridden' },
      { factor: 'climbing', contribution: 25, label: 'Elevation gained' },
      { factor: 'steepness', contribution: 25, label: 'Ride intensity' },
    ];
  }

  const factorLabels: Record<WearFactor, string> = {
    hours: 'Time in saddle',
    distance: 'Distance ridden',
    climbing: 'Elevation gained',
    steepness: 'Ride intensity',
  };

  const drivers: WearDriver[] = [
    {
      factor: 'hours',
      contribution: Math.round((breakdown.hours / total) * 100),
      label: factorLabels.hours,
    },
    {
      factor: 'distance',
      contribution: Math.round((breakdown.distance / total) * 100),
      label: factorLabels.distance,
    },
    {
      factor: 'climbing',
      contribution: Math.round((breakdown.climbing / total) * 100),
      label: factorLabels.climbing,
    },
    {
      factor: 'steepness',
      contribution: Math.round((breakdown.steepness / total) * 100),
      label: factorLabels.steepness,
    },
  ];

  // Sort by contribution descending
  return drivers.sort((a, b) => b.contribution - a.contribution);
}

/**
 * Utility: Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
