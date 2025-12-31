import { format, isValid } from 'date-fns';
import { COMPONENT_LABELS } from '../constants/componentLabels';
import { SECONDS_PER_HOUR } from '../constants/dashboard';
import type { ComponentPrediction } from '../types/prediction';

/**
 * Format duration in compact form (e.g., "1h 30m", "45m")
 */
export function formatDurationCompact(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0m';
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format duration in human-readable form (e.g., "1 hour 30 minutes", "45 minutes")
 */
export function formatDurationReadable(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0 minutes';
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const mins = Math.round((seconds % SECONDS_PER_HOUR) / 60);

  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${mins} minutes`;
}

/**
 * Format a ride date (e.g., "Jan 15")
 */
export function formatRideDate(startTime: string | undefined | null): string {
  if (!startTime) return 'Unknown';
  const date = new Date(startTime);
  if (!isValid(date)) return 'Unknown';
  return format(date, 'MMM d');
}

/**
 * Format elevation with units (e.g., "1,234 ft")
 */
export function formatElevation(feet: number): string {
  if (!feet || isNaN(feet)) return '0 ft';
  return `${Math.round(feet).toLocaleString()} ft`;
}

/**
 * Location labels for component positions
 */
const LOCATION_LABELS: Record<string, string> = {
  FRONT: 'Front',
  REAR: 'Rear',
  NONE: '',
};

/**
 * Format a component label with optional location (e.g., "Fork", "Brakes (Front)")
 */
export function formatComponentLabel(component: ComponentPrediction): string {
  const baseLabel = COMPONENT_LABELS[component.componentType] ?? component.componentType;
  const locationLabel = LOCATION_LABELS[component.location] ?? '';

  if (locationLabel && component.location !== 'NONE') {
    return `${baseLabel} (${locationLabel})`;
  }
  return baseLabel;
}

/**
 * Bike type definition for getBikeName
 */
interface BikeNameable {
  nickname?: string | null;
  manufacturer: string;
  model: string;
}

/**
 * Get display name for a bike (nickname or "Manufacturer Model")
 */
export function getBikeName(bike: BikeNameable): string {
  return bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim() || 'Bike';
}
