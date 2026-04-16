import { worstHourWmoCode, mean } from './index';

describe('worstHourWmoCode', () => {
  it('picks the single worst hour across a mostly-clear ride', () => {
    // 5 clear + 1 thunderstorm → thunderstorm wins.
    expect(worstHourWmoCode([0, 0, 0, 95, 0, 0])).toBe(95);
  });

  it('picks the highest severity from a mixed rainy ride', () => {
    // Drizzle (53), moderate rain (63), partly cloudy (2) → heavy rain wins.
    expect(worstHourWmoCode([53, 63, 2])).toBe(63);
  });

  it('ranks freezing rain above plain showers despite lower numeric code', () => {
    // 67 = heavy freezing rain (severe winter), 80 = slight rain showers (mild).
    // Raw numeric max would have incorrectly picked 80.
    expect(worstHourWmoCode([67, 80, 80, 1])).toBe(67);
  });

  it('ranks thunderstorms above any rain/snow', () => {
    expect(worstHourWmoCode([65, 82, 75, 95])).toBe(95);
  });

  it('treats snow showers (86) as worse than steady snow (73)', () => {
    expect(worstHourWmoCode([73, 73, 86])).toBe(86);
  });

  it('returns the sole code when input is length 1', () => {
    expect(worstHourWmoCode([0])).toBe(0);
    expect(worstHourWmoCode([95])).toBe(95);
  });

  it('keeps the code when all are equal', () => {
    expect(worstHourWmoCode([3, 3, 3])).toBe(3);
  });

  it('gracefully handles an unknown WMO code alongside known ones', () => {
    // Unknown codes get severity -1, so any known code beats them.
    expect(worstHourWmoCode([999, 0, 999])).toBe(0);
  });

  it('throws on empty input rather than returning undefined', () => {
    expect(() => worstHourWmoCode([])).toThrow(
      'worstHourWmoCode requires at least one WMO code'
    );
  });
});

describe('mean', () => {
  it('averages only the non-null values', () => {
    expect(mean([10, null, 20, null, 30])).toBe(20);
  });

  it('returns null when every value is null', () => {
    expect(mean([null, null, null])).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(mean([])).toBeNull();
  });

  it('handles a single value', () => {
    expect(mean([42])).toBe(42);
  });

  it('does not treat zero as null', () => {
    expect(mean([0, 0, 0])).toBe(0);
    expect(mean([0, null, 10])).toBe(5);
  });
});
