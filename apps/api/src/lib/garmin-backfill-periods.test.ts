import {
  describeGarminPeriod,
  isRollingGarminPeriod,
  parseGarminPeriodDays,
  resolveGarminPeriodRange,
} from './garmin-backfill-periods';

describe('parseGarminPeriodDays', () => {
  it('reads the offered windows', () => {
    expect(parseGarminPeriodDays('7d')).toBe(7);
    expect(parseGarminPeriodDays('14d')).toBe(14);
    expect(parseGarminPeriodDays('30d')).toBe(30);
  });

  it('rejects anything that is not an offered window', () => {
    // Windows are an allow-list, not a pattern: an arbitrary '90d' would sail
    // past Garmin's chunking rules and past the clients' labels.
    expect(parseGarminPeriodDays('90d')).toBeNull();
    expect(parseGarminPeriodDays('ytd')).toBeNull();
    expect(parseGarminPeriodDays('2024')).toBeNull();
    expect(parseGarminPeriodDays('')).toBeNull();
  });

  it('does not treat inherited Object properties as windows', () => {
    expect(parseGarminPeriodDays('toString')).toBeNull();
    expect(parseGarminPeriodDays('constructor')).toBeNull();
  });
});

describe('isRollingGarminPeriod', () => {
  it('counts the windows and ytd, since both keep moving', () => {
    expect(isRollingGarminPeriod('7d')).toBe(true);
    expect(isRollingGarminPeriod('ytd')).toBe(true);
  });

  it('excludes a calendar year, which is imported once and then done', () => {
    expect(isRollingGarminPeriod('2024')).toBe(false);
  });
});

describe('resolveGarminPeriodRange', () => {
  it('measures the window back from now', () => {
    const now = new Date('2026-07-30T12:00:00Z');

    const range = resolveGarminPeriodRange('7d', now);

    expect(range).not.toBeNull();
    expect(range!.startDate.toISOString()).toBe('2026-07-23T12:00:00.000Z');
    expect(range!.endDate.toISOString()).toBe('2026-07-30T12:00:00.000Z');
  });

  it('crosses a year boundary rather than clamping to Jan 1', () => {
    const now = new Date('2026-01-05T00:00:00Z');

    const range = resolveGarminPeriodRange('30d', now);

    expect(range!.startDate.toISOString()).toBe('2025-12-06T00:00:00.000Z');
  });

  it('returns null for periods that are not windows', () => {
    expect(resolveGarminPeriodRange('ytd', new Date())).toBeNull();
    expect(resolveGarminPeriodRange('2024', new Date())).toBeNull();
  });

  it('does not hand back the caller their own Date to mutate', () => {
    const now = new Date('2026-07-30T12:00:00Z');

    const range = resolveGarminPeriodRange('14d', now);
    range!.endDate.setFullYear(1999);

    expect(now.toISOString()).toBe('2026-07-30T12:00:00.000Z');
  });
});

describe('describeGarminPeriod', () => {
  it('phrases a window for user-facing messages', () => {
    expect(describeGarminPeriod('7d')).toBe('the last 7 days');
  });

  it('passes other periods through untouched', () => {
    expect(describeGarminPeriod('2024')).toBe('2024');
  });
});
