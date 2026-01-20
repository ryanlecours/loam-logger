import { format, isValid, parseISO } from 'date-fns';
import { COMPONENT_LABELS } from '../constants/componentLabels';
import { SECONDS_PER_HOUR } from '../constants/dashboard';

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
 * Parse a date string that may be either a Unix timestamp (ms) or an ISO string
 */
function parseFlexibleDate(dateStr: string): Date {
  // If it's a numeric string (Unix timestamp in ms), convert to number first
  if (/^\d+$/.test(dateStr)) {
    return new Date(Number(dateStr));
  }
  // Otherwise treat as ISO string
  return parseISO(dateStr);
}

/**
 * Format a ride date (e.g., "Jan 15, 2024")
 */
export function formatRideDate(startTime: string | undefined | null): string {
  if (!startTime) return 'Unknown';
  const date = parseFlexibleDate(startTime);
  if (!isValid(date)) return 'Unknown';
  return format(date, 'MMM d, yyyy');
}

/**
 * Format elevation with units (e.g., "1,234 ft")
 */
export function formatElevation(feet: number): string {
  if (!feet || isNaN(feet)) return '0 ft';
  return `${Math.round(feet).toLocaleString()} ft`;
}

/**
 * Format distance in compact form (e.g., "12.3 mi")
 */
export function formatDistanceCompact(miles: number): string {
  if (!miles || isNaN(miles) || miles < 0) return '0 mi';
  return `${miles.toFixed(1)} mi`;
}

/**
 * Format a date with specified style
 */
export function formatDate(date: Date, style: 'short' | 'long' = 'long'): string {
  if (!isValid(date)) return 'Unknown';
  if (style === 'short') {
    return format(date, 'MMM d');
  }
  return format(date, 'MMM d, yyyy');
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
 * Minimal interface for formatComponentLabel - only needs these two fields
 */
interface ComponentLabelable {
  componentType: string;
  location?: string | null;
}

/**
 * Format a component label with optional location (e.g., "Fork", "Brakes (Front)")
 */
export function formatComponentLabel(component: ComponentLabelable): string {
  const baseLabel = COMPONENT_LABELS[component.componentType] ?? component.componentType;
  const location = component.location ?? 'NONE';
  const locationLabel = LOCATION_LABELS[location] ?? '';

  if (locationLabel && location !== 'NONE') {
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
