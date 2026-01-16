/**
 * BikeSpec Derivation Utilities
 *
 * Functions to derive a normalized BikeSpec from bike data and 99Spokes components.
 * BikeSpec is used to determine which components are applicable to a given bike.
 */

import type { BikeSpec } from '../componentCatalog';

/**
 * Component data shape from 99Spokes or similar sources
 */
export interface SpokesComponentData {
  make?: string;
  maker?: string;
  model?: string;
  description?: string;
  kind?: string;
}

/**
 * Bike data shape for spec derivation
 */
export interface BikeData {
  travelForkMm?: number | null;
  travelShockMm?: number | null;
}

/**
 * 99Spokes components object shape
 */
export interface SpokesComponents {
  brakes?: SpokesComponentData;
  rearDerailleur?: SpokesComponentData;
  fork?: SpokesComponentData;
  rearShock?: SpokesComponentData;
  seatpost?: SpokesComponentData;
  [key: string]: SpokesComponentData | undefined;
}

/**
 * Check if a component has meaningful data (description or maker+model).
 * Used to detect suspension components from 99Spokes data.
 *
 * @param component - Component data from 99Spokes
 * @returns true if component has description or both maker and model
 */
function hasComponentData(component?: SpokesComponentData): boolean {
  if (!component) return false;
  if (component.description?.trim()) return true;
  const maker = component.maker?.trim() || component.make?.trim();
  const model = component.model?.trim();
  return !!(maker && model);
}

/**
 * Parse travel value from a component description string.
 * Looks for patterns like "160mm", "150 mm", etc.
 *
 * @param description - Component description string
 * @returns Travel value in mm, or null if not found
 */
export function parseTravelFromDescription(description?: string): number | null {
  if (!description) return null;

  // Match patterns like "160mm", "150 mm", "170MM"
  const match = description.match(/(\d{2,3})\s*mm/i);
  if (match) {
    const value = parseInt(match[1], 10);
    // Sanity check: suspension travel typically 30-220mm
    if (value >= 30 && value <= 220) {
      return value;
    }
  }

  return null;
}

/**
 * Derive a BikeSpec from bike data and optional 99Spokes component info.
 *
 * Suspension detection prioritizes 99Spokes component data over travel values,
 * with travel values as a fallback for manually entered bikes.
 *
 * @param bike - Basic bike data with travel values
 * @param spokesComponents - Optional component data from 99Spokes
 * @returns Normalized BikeSpec for component applicability checks
 */
export function deriveBikeSpec(
  bike: BikeData,
  spokesComponents?: SpokesComponents
): BikeSpec {
  return {
    hasFrontSuspension:
      hasComponentData(spokesComponents?.fork) || (bike.travelForkMm ?? 0) > 0,
    hasRearSuspension:
      hasComponentData(spokesComponents?.rearShock) ||
      (bike.travelShockMm ?? 0) > 0,
    brakeType: detectBrakeType(spokesComponents?.brakes?.description),
    drivetrainType: detectDrivetrainType(
      spokesComponents?.rearDerailleur?.description
    ),
  };
}

/**
 * Detect brake type from component description.
 * Defaults to 'disc' for modern mountain bikes.
 *
 * @param description - Brake component description from 99Spokes
 * @returns 'disc' | 'rim' | undefined
 */
export function detectBrakeType(
  description?: string
): 'disc' | 'rim' | undefined {
  if (!description) {
    // Default to disc for modern bikes
    return 'disc';
  }

  const lower = description.toLowerCase();

  // Check for disc brake indicators
  if (
    lower.includes('disc') ||
    lower.includes('hydraulic') ||
    lower.includes('shimano') ||
    lower.includes('sram') ||
    lower.includes('magura') ||
    lower.includes('hope') ||
    lower.includes('hayes') ||
    lower.includes('tektro')
  ) {
    return 'disc';
  }

  // Check for rim brake indicators
  if (
    lower.includes('rim') ||
    lower.includes('v-brake') ||
    lower.includes('v brake') ||
    lower.includes('caliper') ||
    lower.includes('cantilever')
  ) {
    return 'rim';
  }

  // Default to disc for mountain bikes
  return 'disc';
}

/**
 * Detect drivetrain type (1x, 2x, 3x) from component description.
 * Defaults to '1x' for modern mountain bikes.
 *
 * @param description - Rear derailleur or shifter description from 99Spokes
 * @returns '1x' | '2x' | '3x' | undefined
 */
export function detectDrivetrainType(
  description?: string
): '1x' | '2x' | '3x' | undefined {
  if (!description) {
    // Default to 1x for modern bikes
    return '1x';
  }

  const normalized = description.toUpperCase();

  // Check for explicit 1x/2x/3x markers
  if (normalized.includes('1X') || normalized.includes('1 X')) {
    return '1x';
  }
  if (normalized.includes('2X') || normalized.includes('2 X')) {
    return '2x';
  }
  if (normalized.includes('3X') || normalized.includes('3 X')) {
    return '3x';
  }

  // Check for speed indicators that suggest drivetrain type
  // 12-speed, 11-speed typically 1x on modern MTB
  if (
    normalized.includes('12-SPEED') ||
    normalized.includes('12 SPEED') ||
    normalized.includes('11-SPEED') ||
    normalized.includes('11 SPEED')
  ) {
    return '1x';
  }

  // 10-speed could be 1x or 2x, default to 1x
  if (normalized.includes('10-SPEED') || normalized.includes('10 SPEED')) {
    return '1x';
  }

  // 9-speed often 2x or 3x on older bikes
  if (normalized.includes('9-SPEED') || normalized.includes('9 SPEED')) {
    return '2x';
  }

  // Default to 1x for modern mountain bikes
  return '1x';
}

/**
 * Check if a bike has any suspension (front or rear).
 */
export function hasSuspension(spec: BikeSpec): boolean {
  return spec.hasFrontSuspension || spec.hasRearSuspension;
}

/**
 * Check if a bike is a hardtail (front suspension only).
 */
export function isHardtail(spec: BikeSpec): boolean {
  return spec.hasFrontSuspension && !spec.hasRearSuspension;
}

/**
 * Check if a bike is full suspension.
 */
export function isFullSuspension(spec: BikeSpec): boolean {
  return spec.hasFrontSuspension && spec.hasRearSuspension;
}

/**
 * Check if a bike is rigid (no suspension).
 */
export function isRigid(spec: BikeSpec): boolean {
  return !spec.hasFrontSuspension && !spec.hasRearSuspension;
}
