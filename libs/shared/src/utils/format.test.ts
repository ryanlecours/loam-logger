import { fmtDateTime, fmtDuration, fmtMiles, fmtFeet, toLocalInputValue, fromLocalInputValue } from './format';

describe('fmtDuration', () => {
  it('should format 0 seconds as 0m', () => {
    expect(fmtDuration(0)).toBe('0m');
  });

  it('should format seconds less than 60 as minutes', () => {
    expect(fmtDuration(30)).toBe('1m'); // rounds to 1 min
    expect(fmtDuration(59)).toBe('1m');
  });

  it('should format exactly 60 seconds as 1m', () => {
    expect(fmtDuration(60)).toBe('1m');
  });

  it('should format minutes without hours', () => {
    expect(fmtDuration(120)).toBe('2m');
    expect(fmtDuration(300)).toBe('5m');
    expect(fmtDuration(3599)).toBe('60m'); // just under 1 hour
  });

  it('should format hours and minutes', () => {
    expect(fmtDuration(3600)).toBe('1h 0m');
    expect(fmtDuration(3660)).toBe('1h 1m');
    expect(fmtDuration(3661)).toBe('1h 1m');
    expect(fmtDuration(7200)).toBe('2h 0m');
  });

  it('should format large durations', () => {
    expect(fmtDuration(86400)).toBe('24h 0m');
    expect(fmtDuration(90061)).toBe('25h 1m');
  });

  it('should round minutes correctly', () => {
    // 3630 = 1h 0.5m -> rounds to 1h 1m
    expect(fmtDuration(3630)).toBe('1h 1m');
  });
});

describe('fmtMiles', () => {
  it('should format zero', () => {
    expect(fmtMiles(0)).toBe('0.0 mi');
  });

  it('should format with one decimal place', () => {
    expect(fmtMiles(5)).toBe('5.0 mi');
    expect(fmtMiles(5.5)).toBe('5.5 mi');
    expect(fmtMiles(5.56)).toBe('5.6 mi'); // rounds up
    expect(fmtMiles(5.54)).toBe('5.5 mi'); // rounds down
  });

  it('should format large numbers', () => {
    expect(fmtMiles(100.123)).toBe('100.1 mi');
  });

  it('should format very small numbers', () => {
    expect(fmtMiles(0.04)).toBe('0.0 mi');
    expect(fmtMiles(0.05)).toBe('0.1 mi');
  });
});

describe('fmtFeet', () => {
  it('should format zero', () => {
    expect(fmtFeet(0)).toBe('0 ft');
  });

  it('should round to nearest integer', () => {
    expect(fmtFeet(5.4)).toBe('5 ft');
    expect(fmtFeet(5.5)).toBe('6 ft');
    expect(fmtFeet(5.6)).toBe('6 ft');
  });

  it('should format large numbers', () => {
    expect(fmtFeet(1000)).toBe('1000 ft');
    expect(fmtFeet(1000.7)).toBe('1001 ft');
  });
});

describe('fmtDateTime', () => {
  it('should format a timestamp', () => {
    // Test with a known timestamp - Jan 1, 2023 12:00 UTC
    const timestamp = 1672574400000;
    const result = fmtDateTime(timestamp);
    // Result depends on locale, but should be a non-empty string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should format epoch 0', () => {
    const result = fmtDateTime(0);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('toLocalInputValue', () => {
  // Use a fixed date for testing
  const fixedDate = new Date('2023-06-15T14:30:00');
  const fixedTimestamp = fixedDate.getTime();

  it('should handle Date object', () => {
    const result = toLocalInputValue(fixedDate);
    // Should be in yyyy-MM-ddTHH:mm format (local time)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should handle epoch milliseconds as number', () => {
    const result = toLocalInputValue(fixedTimestamp);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should handle epoch seconds as number (< 1e12)', () => {
    const epochSeconds = Math.floor(fixedTimestamp / 1000);
    const result = toLocalInputValue(epochSeconds);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should handle ISO string', () => {
    const result = toLocalInputValue('2023-06-15T14:30:00Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should handle numeric string (epoch seconds)', () => {
    const epochSeconds = Math.floor(fixedTimestamp / 1000).toString();
    const result = toLocalInputValue(epochSeconds);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should return current date for invalid input', () => {
    const result = toLocalInputValue('invalid-date');
    // Should fall back to current date
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('should zero-pad single digit values', () => {
    const jan1 = new Date('2023-01-01T09:05:00');
    const result = toLocalInputValue(jan1);
    expect(result).toMatch(/^\d{4}-01-01T\d{2}:\d{2}$/);
  });
});

describe('fromLocalInputValue', () => {
  it('should convert datetime-local string to ISO', () => {
    const result = fromLocalInputValue('2023-06-15T14:30');
    // Should be an ISO string ending with Z
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('should handle midnight', () => {
    const result = fromLocalInputValue('2023-06-15T00:00');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('should handle end of day', () => {
    const result = fromLocalInputValue('2023-06-15T23:59');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});
