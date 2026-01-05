import { useState, useMemo, useCallback } from 'react';
import type { BikePredictionSummary, PredictionStatus } from '../types/prediction';
import { STATUS_SEVERITY } from '../types/prediction';

export interface BikeWithPredictions {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  thumbnailUrl?: string | null;
  sortOrder: number;
  predictions: BikePredictionSummary | null;
}

interface UsePriorityBikeResult {
  /** The default bike ID (first in user's sort order) */
  priorityBikeId: string | null;
  /** The user-selected bike ID (null if showing default) */
  selectedBikeId: string | null;
  /** The bike currently being displayed */
  displayedBike: BikeWithPredictions | null;
  /** Whether we're showing the default bike (not user-selected) */
  isShowingPriority: boolean;
  /** Select a specific bike */
  selectBike: (bikeId: string) => void;
  /** Reset to show default bike */
  resetToPriority: () => void;
  /** All bikes sorted by user's sortOrder */
  sortedBikes: BikeWithPredictions[];
}

/**
 * Manages bike selection state and provides sorted bikes.
 *
 * Sorting: User-defined sortOrder (ascending)
 * Default bike: First in user's sort order
 */
export function usePriorityBike(bikes: BikeWithPredictions[]): UsePriorityBikeResult {
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(null);

  // Sort bikes by user's sortOrder
  const sortedBikes = useMemo(() => {
    return [...bikes].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [bikes]);

  // Compute priority bike ID
  const priorityBikeId = useMemo(() => {
    if (sortedBikes.length === 0) return null;
    return sortedBikes[0].id;
  }, [sortedBikes]);

  // Get displayed bike
  const displayedBikeId = selectedBikeId ?? priorityBikeId;
  const displayedBike = useMemo(() => {
    if (!displayedBikeId) return null;
    return bikes.find((b) => b.id === displayedBikeId) ?? null;
  }, [bikes, displayedBikeId]);

  const isShowingPriority = !selectedBikeId || selectedBikeId === priorityBikeId;

  const selectBike = useCallback((bikeId: string) => {
    setSelectedBikeId(bikeId);
  }, []);

  const resetToPriority = useCallback(() => {
    setSelectedBikeId(null);
  }, []);

  return {
    priorityBikeId,
    selectedBikeId,
    displayedBike,
    isShowingPriority,
    selectBike,
    resetToPriority,
    sortedBikes,
  };
}

/**
 * Get the top N due components from a bike's predictions.
 * Filters to urgent statuses and sorts by severity + hoursRemaining.
 */
export function getTopDueComponents(
  predictions: BikePredictionSummary | null,
  count: number = 3
) {
  if (!predictions?.components) return [];

  const urgentStatuses: PredictionStatus[] = ['OVERDUE', 'DUE_NOW', 'DUE_SOON'];

  // Filter to urgent components, or include ALL_GOOD if none urgent
  let components = predictions.components.filter((c) =>
    urgentStatuses.includes(c.status)
  );

  // If no urgent components, take from all
  if (components.length === 0) {
    components = predictions.components;
  }

  // Sort by severity then hours remaining
  return [...components]
    .sort((a, b) => {
      const severityDiff = STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status];
      if (severityDiff !== 0) return severityDiff;
      return a.hoursRemaining - b.hoursRemaining;
    })
    .slice(0, count);
}
