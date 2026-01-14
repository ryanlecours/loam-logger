import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBikeRides, type BikeRide } from './useBikeRides';

// Mock Apollo Client's useLazyQuery
const mockFetchOlderRides = vi.fn();

vi.mock('@apollo/client', () => ({
  useLazyQuery: vi.fn(() => {
    return [mockFetchOlderRides, { loading: false }];
  }),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Factory for creating test rides
const createRide = (overrides: Partial<BikeRide> = {}): BikeRide => ({
  id: `ride-${Math.random().toString(36).slice(2)}`,
  startTime: new Date().toISOString(),
  durationSeconds: 3600,
  distanceMiles: 10,
  elevationGainFeet: 1000,
  bikeId: 'bike-1',
  ...overrides,
});

describe('useBikeRides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('returns empty rides when bikeId is null', () => {
      const { result } = renderHook(() => useBikeRides(null, [], 4));

      expect(result.current.rides).toEqual([]);
      expect(result.current.pageIndex).toBe(0);
      expect(result.current.canGoNewer).toBe(false);
      // hasMoreOlder defaults to true (we don't know if there are more)
      // but goOlder won't do anything without a bikeId
    });

    it('filters rides for the specified bike', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: 'bike-1' }),
        createRide({ id: 'ride-2', bikeId: 'bike-2' }),
        createRide({ id: 'ride-3', bikeId: 'bike-1' }),
      ];

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides).toHaveLength(2);
      expect(result.current.rides.every((r) => r.bikeId === 'bike-1')).toBe(true);
    });

    it('sorts rides by startTime descending (newest first)', () => {
      const rides = [
        createRide({ id: 'old', bikeId: 'bike-1', startTime: '2024-01-01T00:00:00Z' }),
        createRide({ id: 'new', bikeId: 'bike-1', startTime: '2024-01-03T00:00:00Z' }),
        createRide({ id: 'mid', bikeId: 'bike-1', startTime: '2024-01-02T00:00:00Z' }),
      ];

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
    });
  });

  describe('pagination', () => {
    it('returns only pageSize rides per page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({
          id: `ride-${i}`,
          bikeId: 'bike-1',
          startTime: new Date(2024, 0, 10 - i).toISOString(),
        })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides).toHaveLength(4);
    });

    it('canGoNewer is false on first page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.canGoNewer).toBe(false);
    });

    it('canGoOlder is true when more rides exist', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.canGoOlder).toBe(true);
    });

    it('goOlder increments pageIndex', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.pageIndex).toBe(0);

      act(() => {
        result.current.goOlder();
      });

      expect(result.current.pageIndex).toBe(1);
    });

    it('goNewer decrements pageIndex', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goOlder();
        result.current.goOlder();
      });

      expect(result.current.pageIndex).toBe(2);

      act(() => {
        result.current.goNewer();
      });

      expect(result.current.pageIndex).toBe(1);
    });

    it('goNewer does nothing on first page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goNewer();
      });

      expect(result.current.pageIndex).toBe(0);
    });
  });

  describe('range info', () => {
    it('returns correct range info for first page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rangeInfo).toEqual({
        start: 1,
        end: 4,
        total: 10,
        hasMore: true,
      });
    });

    it('returns correct range info for middle page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goOlder();
      });

      expect(result.current.rangeInfo).toEqual({
        start: 5,
        end: 8,
        total: 10,
        hasMore: true,
      });
    });

    it('returns correct range info for last page', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goOlder();
        result.current.goOlder();
      });

      expect(result.current.rangeInfo).toEqual({
        start: 9,
        end: 10,
        total: 10,
        hasMore: true,
      });
    });

    it('returns zero start for empty rides', () => {
      const { result } = renderHook(() => useBikeRides('bike-1', [], 4));

      expect(result.current.rangeInfo.start).toBe(0);
      expect(result.current.rangeInfo.end).toBe(0);
      expect(result.current.rangeInfo.total).toBe(0);
    });
  });

  describe('bike ID changes', () => {
    it('resets pageIndex when bikeId changes', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result, rerender } = renderHook(
        ({ bikeId }) => useBikeRides(bikeId, rides, 4),
        { initialProps: { bikeId: 'bike-1' } }
      );

      act(() => {
        result.current.goOlder();
      });

      expect(result.current.pageIndex).toBe(1);

      rerender({ bikeId: 'bike-2' });

      expect(result.current.pageIndex).toBe(0);
    });

    it('resets hasMoreOlder when bikeId changes', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: 'bike-1' })];

      const { result, rerender } = renderHook(
        ({ bikeId }) => useBikeRides(bikeId, rides, 4),
        { initialProps: { bikeId: 'bike-1' } }
      );

      // hasMoreOlder starts as true (we don't know if there are more yet)
      expect(result.current.canGoOlder).toBe(true);

      rerender({ bikeId: 'bike-2' });

      // Should reset to true for new bike
      expect(result.current.canGoOlder).toBe(true);
    });
  });

  describe('deduplication', () => {
    it('includes all initial rides (dedup happens on merge with fetched)', () => {
      // Note: The hook does NOT dedupe initial rides within themselves.
      // Deduplication only occurs when merging additionalRides with initialRides.
      // This test verifies the hook returns all initial rides for the bike.
      const rides = [
        createRide({ id: 'ride-1', bikeId: 'bike-1' }),
        createRide({ id: 'ride-2', bikeId: 'bike-1' }),
        createRide({ id: 'ride-3', bikeId: 'bike-1' }),
      ];

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides).toHaveLength(3);
      expect(result.current.rides.map((r) => r.id)).toContain('ride-1');
      expect(result.current.rides.map((r) => r.id)).toContain('ride-2');
      expect(result.current.rides.map((r) => r.id)).toContain('ride-3');
    });
  });

  describe('lazy loading', () => {
    it('triggers fetch when navigating beyond available rides', () => {
      const rides = Array.from({ length: 4 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goOlder();
      });

      expect(mockFetchOlderRides).toHaveBeenCalled();
    });

    it('does not trigger fetch when more local rides available', () => {
      const rides = Array.from({ length: 10 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      act(() => {
        result.current.goOlder();
      });

      // Should not fetch because we have enough local rides
      expect(mockFetchOlderRides).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles empty initialRides array', () => {
      const { result } = renderHook(() => useBikeRides('bike-1', [], 4));

      expect(result.current.rides).toEqual([]);
      expect(result.current.canGoNewer).toBe(false);
      expect(result.current.canGoOlder).toBe(true); // Still true because we might fetch more
    });

    it('handles single ride', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: 'bike-1' })];

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides).toHaveLength(1);
      expect(result.current.rangeInfo.start).toBe(1);
      expect(result.current.rangeInfo.end).toBe(1);
      expect(result.current.rangeInfo.total).toBe(1);
    });

    it('handles rides exactly matching page size', () => {
      const rides = Array.from({ length: 4 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 4));

      expect(result.current.rides).toHaveLength(4);
      expect(result.current.rangeInfo.end).toBe(4);
    });

    it('handles custom page sizes', () => {
      const rides = Array.from({ length: 12 }, (_, i) =>
        createRide({ id: `ride-${i}`, bikeId: 'bike-1' })
      );

      const { result } = renderHook(() => useBikeRides('bike-1', rides, 6));

      expect(result.current.rides).toHaveLength(6);
      expect(result.current.rangeInfo.end).toBe(6);
    });
  });
});
