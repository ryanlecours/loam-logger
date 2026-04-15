import { worstHourWmoCode, mean } from './index';

describe('worstHourWmoCode', () => {
  it('picks the single worst hour across a mostly-clear ride', () => {
    // 5 clear + 1 thunderstorm → thunderstorm wins.
    expect(worstHourWmoCode([0, 0, 0, 95, 0, 0])).toBe(95);
  });

  it('picks the highest severity from a mixed rainy ride', () => {
    // Drizzle (53), rain showers (81), heavy rain (65) → 81 is the highest.
    expect(worstHourWmoCode([53, 81, 65, 1])).toBe(81);
  });

  it('returns the sole code when input is length 1', () => {
    expect(worstHourWmoCode([0])).toBe(0);
    expect(worstHourWmoCode([95])).toBe(95);
  });

  it('keeps the max when all codes are equal', () => {
    expect(worstHourWmoCode([3, 3, 3])).toBe(3);
  });

  it('treats snow showers (86) as worse than steady snow (73)', () => {
    expect(worstHourWmoCode([73, 73, 86])).toBe(86);
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
