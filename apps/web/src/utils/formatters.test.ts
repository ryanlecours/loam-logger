import { describe, it, expect } from 'vitest';
import {
  formatDurationCompact,
  formatDurationReadable,
  formatRideDate,
  formatElevation,
  formatComponentLabel,
  getBikeName,
} from './formatters';
import type { ComponentPrediction } from '../types/prediction';

describe('formatDurationCompact', () => {
  it('returns "0m" for 0 seconds', () => {
    expect(formatDurationCompact(0)).toBe('0m');
  });

  it('returns "0m" for negative values', () => {
    expect(formatDurationCompact(-100)).toBe('0m');
  });

  it('returns "0m" for NaN', () => {
    expect(formatDurationCompact(NaN)).toBe('0m');
  });

  it('formats minutes only when under an hour', () => {
    expect(formatDurationCompact(1800)).toBe('30m');
    expect(formatDurationCompact(2700)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDurationCompact(3600)).toBe('1h 0m');
    expect(formatDurationCompact(5400)).toBe('1h 30m');
    expect(formatDurationCompact(7200)).toBe('2h 0m');
  });

  it('handles large values', () => {
    expect(formatDurationCompact(36000)).toBe('10h 0m');
    expect(formatDurationCompact(86400)).toBe('24h 0m');
  });

  it('truncates partial minutes', () => {
    expect(formatDurationCompact(90)).toBe('1m');
    expect(formatDurationCompact(119)).toBe('1m');
  });
});

describe('formatDurationReadable', () => {
  it('returns "0 minutes" for 0 seconds', () => {
    expect(formatDurationReadable(0)).toBe('0 minutes');
  });

  it('returns "0 minutes" for negative values', () => {
    expect(formatDurationReadable(-100)).toBe('0 minutes');
  });

  it('returns "0 minutes" for NaN', () => {
    expect(formatDurationReadable(NaN)).toBe('0 minutes');
  });

  it('formats minutes only when under an hour', () => {
    expect(formatDurationReadable(1800)).toBe('30 minutes');
    expect(formatDurationReadable(2700)).toBe('45 minutes');
  });

  it('formats hours and minutes together', () => {
    expect(formatDurationReadable(5400)).toBe('1h 30m');
    expect(formatDurationReadable(9000)).toBe('2h 30m');
  });

  it('uses singular "hour" for 1 hour with no minutes', () => {
    expect(formatDurationReadable(3600)).toBe('1 hour');
  });

  it('uses plural "hours" for multiple hours with no minutes', () => {
    expect(formatDurationReadable(7200)).toBe('2 hours');
    expect(formatDurationReadable(10800)).toBe('3 hours');
  });

  it('rounds minutes', () => {
    expect(formatDurationReadable(90)).toBe('2 minutes');
    expect(formatDurationReadable(30)).toBe('1 minutes');
  });
});

describe('formatRideDate', () => {
  it('returns "Unknown" for null', () => {
    expect(formatRideDate(null)).toBe('Unknown');
  });

  it('returns "Unknown" for undefined', () => {
    expect(formatRideDate(undefined)).toBe('Unknown');
  });

  it('returns "Unknown" for empty string', () => {
    expect(formatRideDate('')).toBe('Unknown');
  });

  it('returns "Unknown" for invalid date string', () => {
    expect(formatRideDate('not-a-date')).toBe('Unknown');
  });

  it('formats valid ISO date strings', () => {
    // Use noon UTC to avoid timezone edge cases
    expect(formatRideDate('2024-01-15T12:00:00Z')).toBe('Jan 15, 2024');
    expect(formatRideDate('2024-12-25T12:00:00Z')).toBe('Dec 25, 2024');
  });

  it('formats date strings with timezone offset', () => {
    // Using explicit timezone offset for predictable results
    expect(formatRideDate('2024-07-04T12:00:00-05:00')).toBe('Jul 4, 2024');
  });

  it('formats Unix timestamp strings (milliseconds)', () => {
    // 1705320000000 = Jan 15, 2024 12:00:00 UTC
    expect(formatRideDate('1705320000000')).toBe('Jan 15, 2024');
    // 1735128000000 = Dec 25, 2024 12:00:00 UTC
    expect(formatRideDate('1735128000000')).toBe('Dec 25, 2024');
  });

  it('handles edge cases for numeric strings', () => {
    // Unix epoch (0) is valid - exact date depends on timezone
    const epochResult = formatRideDate('0');
    expect(epochResult).toMatch(/^(Dec 31, 1969|Jan 1, 1970)$/); // Depends on TZ

    // Negative numbers have a dash, so not purely numeric - treated as ISO and invalid
    expect(formatRideDate('-1')).toBe('Unknown');
  });
});

describe('formatElevation', () => {
  it('returns "0 ft" for 0', () => {
    expect(formatElevation(0)).toBe('0 ft');
  });

  it('returns "0 ft" for NaN', () => {
    expect(formatElevation(NaN)).toBe('0 ft');
  });

  it('formats small numbers', () => {
    expect(formatElevation(100)).toBe('100 ft');
    expect(formatElevation(500)).toBe('500 ft');
  });

  it('formats large numbers with locale separators', () => {
    expect(formatElevation(1234)).toBe('1,234 ft');
    expect(formatElevation(10000)).toBe('10,000 ft');
  });

  it('rounds decimal values', () => {
    expect(formatElevation(1234.5)).toBe('1,235 ft');
    expect(formatElevation(1234.4)).toBe('1,234 ft');
  });
});

describe('formatComponentLabel', () => {
  const createComponent = (
    componentType: string,
    location: string
  ): ComponentPrediction =>
    ({
      componentId: 'test-id',
      componentType,
      location,
      brand: 'Test',
      model: 'Model',
      status: 'ALL_GOOD',
      hoursRemaining: 100,
      ridesRemainingEstimate: 10,
      confidence: 'HIGH',
      currentHours: 50,
      serviceIntervalHours: 150,
      hoursSinceService: 50,
      why: null,
      drivers: null,
    }) as ComponentPrediction;

  it('formats known component types without location', () => {
    expect(formatComponentLabel(createComponent('FORK', 'NONE'))).toBe('Fork');
    expect(formatComponentLabel(createComponent('SHOCK', 'NONE'))).toBe('Rear Shock');
    expect(formatComponentLabel(createComponent('CHAIN', 'NONE'))).toBe('Chain');
  });

  it('formats components with FRONT location', () => {
    expect(formatComponentLabel(createComponent('BRAKES', 'FRONT'))).toBe(
      'Front Brake'
    );
    expect(formatComponentLabel(createComponent('BRAKE_PAD', 'FRONT'))).toBe(
      'Front Brake Pads'
    );
  });

  it('formats components with REAR location', () => {
    expect(formatComponentLabel(createComponent('BRAKES', 'REAR'))).toBe(
      'Rear Brake'
    );
    expect(formatComponentLabel(createComponent('TIRES', 'REAR'))).toBe(
      'Rear Tire'
    );
  });

  it('returns component type for unknown types', () => {
    expect(formatComponentLabel(createComponent('UNKNOWN_TYPE', 'NONE'))).toBe(
      'UNKNOWN_TYPE'
    );
  });

  it('handles unknown types with locations', () => {
    expect(formatComponentLabel(createComponent('CUSTOM', 'FRONT'))).toBe(
      'Front CUSTOM'
    );
  });
});

describe('getBikeName', () => {
  it('returns nickname when present', () => {
    expect(
      getBikeName({ nickname: 'The Beast', manufacturer: 'Trek', model: 'Fuel' })
    ).toBe('The Beast');
  });

  it('returns manufacturer + model when nickname is null', () => {
    expect(
      getBikeName({ nickname: null, manufacturer: 'Santa Cruz', model: 'Hightower' })
    ).toBe('Santa Cruz Hightower');
  });

  it('returns manufacturer + model when nickname is undefined', () => {
    expect(
      getBikeName({ manufacturer: 'Yeti', model: 'SB150' })
    ).toBe('Yeti SB150');
  });

  it('returns manufacturer + model when nickname is empty string', () => {
    expect(
      getBikeName({ nickname: '', manufacturer: 'Specialized', model: 'Stumpjumper' })
    ).toBe('Specialized Stumpjumper');
  });

  it('returns manufacturer + model when nickname is whitespace only', () => {
    expect(
      getBikeName({ nickname: '   ', manufacturer: 'Giant', model: 'Trance' })
    ).toBe('Giant Trance');
  });

  it('trims nickname whitespace', () => {
    expect(
      getBikeName({ nickname: '  My Bike  ', manufacturer: 'Trek', model: 'Fuel' })
    ).toBe('My Bike');
  });

  it('returns "Bike" as fallback when all fields are empty', () => {
    expect(getBikeName({ nickname: '', manufacturer: '', model: '' })).toBe('Bike');
  });
});
