import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the utility functions extracted from Rides.tsx logic
// Since these are defined inline in the component, we test the logic patterns

describe('Rides page date filter logic', () => {
  describe('getYearOptions', () => {
    let mockDate: Date;

    beforeEach(() => {
      mockDate = new Date('2024-06-15T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates years from current year back to 2020', () => {
      const getYearOptions = (): number[] => {
        const currentYear = new Date().getFullYear();
        const years: number[] = [];
        for (let year = currentYear; year >= 2020; year--) {
          years.push(year);
        }
        return years;
      };

      const result = getYearOptions();

      expect(result).toEqual([2024, 2023, 2022, 2021, 2020]);
    });

    it('starts with current year', () => {
      const getYearOptions = (): number[] => {
        const currentYear = new Date().getFullYear();
        const years: number[] = [];
        for (let year = currentYear; year >= 2020; year--) {
          years.push(year);
        }
        return years;
      };

      const result = getYearOptions();

      expect(result[0]).toBe(2024);
    });

    it('ends with 2020', () => {
      const getYearOptions = (): number[] => {
        const currentYear = new Date().getFullYear();
        const years: number[] = [];
        for (let year = currentYear; year >= 2020; year--) {
          years.push(year);
        }
        return years;
      };

      const result = getYearOptions();

      expect(result[result.length - 1]).toBe(2020);
    });
  });

  describe('getDateRangeLabel', () => {
    type DateRange = '30days' | '3months' | '6months' | '1year' | number;

    const getDateRangeLabel = (range: DateRange): string => {
      if (typeof range === 'number') return String(range);
      switch (range) {
        case '30days': return 'Last 30 days';
        case '3months': return 'Last 3 months';
        case '6months': return 'Last 6 months';
        case '1year': return 'Last year';
      }
    };

    it('returns "Last 30 days" for 30days', () => {
      expect(getDateRangeLabel('30days')).toBe('Last 30 days');
    });

    it('returns "Last 3 months" for 3months', () => {
      expect(getDateRangeLabel('3months')).toBe('Last 3 months');
    });

    it('returns "Last 6 months" for 6months', () => {
      expect(getDateRangeLabel('6months')).toBe('Last 6 months');
    });

    it('returns "Last year" for 1year', () => {
      expect(getDateRangeLabel('1year')).toBe('Last year');
    });

    it('returns year as string for number', () => {
      expect(getDateRangeLabel(2023)).toBe('2023');
      expect(getDateRangeLabel(2020)).toBe('2020');
    });
  });

  describe('getDateRangeFilter', () => {
    let mockDate: Date;

    beforeEach(() => {
      mockDate = new Date('2024-06-15T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    type DateRange = '30days' | '3months' | '6months' | '1year' | number;

    const getDateRangeFilter = (range: DateRange) => {
      if (typeof range === 'number') {
        const startDate = new Date(range, 0, 1, 0, 0, 0, 0);
        const endDate = new Date(range, 11, 31, 23, 59, 59, 999);
        return {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        };
      }

      const now = new Date();
      const endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);

      const startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      switch (range) {
        case '30days':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '3months':
          startDate.setMonth(startDate.getMonth() - 3);
          break;
        case '6months':
          startDate.setMonth(startDate.getMonth() - 6);
          break;
        case '1year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      return {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    };

    describe('preset ranges', () => {
      it('calculates 30 days range', () => {
        const result = getDateRangeFilter('30days');

        const startDate = new Date(result.startDate);
        const endDate = new Date(result.endDate);

        // Start should be 30 days before mock date
        expect(startDate.getMonth()).toBe(4); // May (0-indexed)
        expect(startDate.getDate()).toBe(16);

        // End should be end of today
        expect(endDate.getMonth()).toBe(5); // June
        expect(endDate.getDate()).toBe(15);
      });

      it('calculates 3 months range', () => {
        const result = getDateRangeFilter('3months');

        const startDate = new Date(result.startDate);

        // Start should be 3 months before June = March
        expect(startDate.getMonth()).toBe(2); // March
      });

      it('calculates 6 months range', () => {
        const result = getDateRangeFilter('6months');

        const startDate = new Date(result.startDate);

        // Start should be 6 months before June = December of previous year
        expect(startDate.getMonth()).toBe(11); // December
        expect(startDate.getFullYear()).toBe(2023);
      });

      it('calculates 1 year range', () => {
        const result = getDateRangeFilter('1year');

        const startDate = new Date(result.startDate);

        // Start should be 1 year before
        expect(startDate.getFullYear()).toBe(2023);
        expect(startDate.getMonth()).toBe(5); // June
      });
    });

    describe('year ranges', () => {
      it('returns Jan 1 to Dec 31 for a specific year', () => {
        const result = getDateRangeFilter(2023);

        const startDate = new Date(result.startDate);
        const endDate = new Date(result.endDate);

        expect(startDate.getFullYear()).toBe(2023);
        expect(startDate.getMonth()).toBe(0); // January
        expect(startDate.getDate()).toBe(1);

        expect(endDate.getFullYear()).toBe(2023);
        expect(endDate.getMonth()).toBe(11); // December
        expect(endDate.getDate()).toBe(31);
      });

      it('sets start time to beginning of day', () => {
        const result = getDateRangeFilter(2023);
        const startDate = new Date(result.startDate);

        expect(startDate.getHours()).toBe(0);
        expect(startDate.getMinutes()).toBe(0);
        expect(startDate.getSeconds()).toBe(0);
      });

      it('sets end time to end of day', () => {
        const result = getDateRangeFilter(2023);
        const endDate = new Date(result.endDate);

        expect(endDate.getHours()).toBe(23);
        expect(endDate.getMinutes()).toBe(59);
        expect(endDate.getSeconds()).toBe(59);
      });
    });
  });
});

describe('DateRange type', () => {
  type DateRange = '30days' | '3months' | '6months' | '1year' | number;

  it('accepts preset string values', () => {
    const range1: DateRange = '30days';
    const range2: DateRange = '3months';
    const range3: DateRange = '6months';
    const range4: DateRange = '1year';

    expect(range1).toBe('30days');
    expect(range2).toBe('3months');
    expect(range3).toBe('6months');
    expect(range4).toBe('1year');
  });

  it('accepts number values for years', () => {
    const range: DateRange = 2023;
    expect(range).toBe(2023);
  });

  it('can be checked for type with typeof', () => {
    const yearRange: DateRange = 2023;
    const presetRange: DateRange = '30days';

    expect(typeof yearRange).toBe('number');
    expect(typeof presetRange).toBe('string');
  });
});
