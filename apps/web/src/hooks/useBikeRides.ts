import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLazyQuery } from '@apollo/client';
import { RIDES } from '../graphql/rides';

export interface BikeRide {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  trailSystem?: string | null;
  location?: string | null;
  bikeId?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

interface UseBikeRidesResult {
  /** Current page of rides to display */
  rides: BikeRide[];
  /** Whether there are newer rides to show */
  canGoNewer: boolean;
  /** Whether there might be older rides to load */
  canGoOlder: boolean;
  /** Navigate to newer rides */
  goNewer: () => void;
  /** Navigate to older rides (lazy loads if needed) */
  goOlder: () => void;
  /** Whether currently loading older rides */
  loading: boolean;
  /** Current page index (for animation keys) */
  pageIndex: number;
  /** Range info for display (e.g., { start: 1, end: 4, total: 12, hasMore: false }) */
  rangeInfo: {
    start: number;
    end: number;
    total: number;
    hasMore: boolean;
  };
}

const DEFAULT_PAGE_SIZE = 4;
const FETCH_BATCH_SIZE = 20;

/**
 * Manages paginated bike rides with lazy loading.
 *
 * Uses initial rides from dashboard cache when possible,
 * then lazy-loads older rides as user navigates backward.
 */
export function useBikeRides(
  bikeId: string | null,
  initialRides: BikeRide[],
  pageSize: number = DEFAULT_PAGE_SIZE
): UseBikeRidesResult {
  const [pageIndex, setPageIndex] = useState(0);
  const [additionalRides, setAdditionalRides] = useState<BikeRide[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);

  // Track mount status to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Lazy query for fetching older rides
  const [fetchOlderRides, { loading }] = useLazyQuery<{ rides: BikeRide[] }>(
    RIDES,
    {
      fetchPolicy: 'cache-first',
      onCompleted: (data) => {
        if (!isMountedRef.current) return;
        if (data?.rides) {
          const bikeSpecificRides = data.rides.filter((r) => r.bikeId === bikeId);
          if (bikeSpecificRides.length < FETCH_BATCH_SIZE) {
            setHasMoreOlder(false);
          }
          setAdditionalRides((prev) => {
            // Merge and dedupe
            const existingIds = new Set(prev.map((r) => r.id));
            const newRides = bikeSpecificRides.filter((r) => !existingIds.has(r.id));
            return [...prev, ...newRides];
          });
        }
      },
    }
  );

  // Reset state when bike changes
  useEffect(() => {
    setPageIndex(0);
    setAdditionalRides([]);
    setHasMoreOlder(true);
  }, [bikeId]);

  // Combine initial rides with additionally fetched rides
  // Note: If initialRides is a new array reference on every render, this will
  // recalculate. Callers should memoize initialRides if performance is a concern.
  const allBikeRides = useMemo(() => {
    if (!bikeId) return [];

    // Filter initial rides for this bike
    const fromInitial = initialRides.filter((r) => r.bikeId === bikeId);

    // Merge with additional rides, deduping by id
    const initialIds = new Set(fromInitial.map((r) => r.id));
    const uniqueAdditional = additionalRides.filter((r) => !initialIds.has(r.id));

    // Combine and sort by startTime descending (newest first)
    return [...fromInitial, ...uniqueAdditional].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }, [bikeId, initialRides, additionalRides]);

  // Calculate current page of rides
  const startIdx = pageIndex * pageSize;
  const endIdx = startIdx + pageSize;
  const currentRides = allBikeRides.slice(startIdx, endIdx);

  // Navigation state
  const canGoNewer = pageIndex > 0;
  const canGoOlder = hasMoreOlder || endIdx < allBikeRides.length;

  // Range info for display
  const rangeInfo = useMemo(() => ({
    start: allBikeRides.length > 0 ? startIdx + 1 : 0,
    end: Math.min(endIdx, allBikeRides.length),
    total: allBikeRides.length,
    hasMore: hasMoreOlder,
  }), [startIdx, endIdx, allBikeRides.length, hasMoreOlder]);

  const goNewer = useCallback(() => {
    if (canGoNewer) {
      setPageIndex((prev) => prev - 1);
    }
  }, [canGoNewer]);

  const goOlder = useCallback(() => {
    if (!canGoOlder || !bikeId) return;

    const nextEndIdx = (pageIndex + 1) * pageSize + pageSize;

    // Check if we need to fetch more rides
    if (nextEndIdx > allBikeRides.length && hasMoreOlder) {
      // Find the oldest ride we have to use as cursor
      const oldestRide = allBikeRides[allBikeRides.length - 1];
      fetchOlderRides({
        variables: {
          take: FETCH_BATCH_SIZE,
          after: oldestRide?.id,
        },
      });
    }

    setPageIndex((prev) => prev + 1);
  }, [canGoOlder, bikeId, pageIndex, pageSize, allBikeRides, hasMoreOlder, fetchOlderRides]);

  return {
    rides: currentRides,
    canGoNewer,
    canGoOlder,
    goNewer,
    goOlder,
    loading,
    pageIndex,
    rangeInfo,
  };
}
