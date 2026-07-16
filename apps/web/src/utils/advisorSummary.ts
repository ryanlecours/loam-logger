import type { AdvisorSummary } from '../types/prediction';
import type { BikeWithPredictions } from '../hooks/usePriorityBike';

/**
 * A row from the BIKES_ADVISOR query. `advisorPredictions` is `predictions`
 * aliased so its partial write doesn't clobber the full predictions the BIKES
 * query cached (see graphql/bikes.ts).
 */
export interface AdvisorBikeRow {
  id: string;
  advisorPredictions: { bikeId: string; advisorSummary: AdvisorSummary | null } | null;
}

/**
 * Build a bikeId -> advisorSummary lookup from the advisor query result.
 * Bikes whose advisorPredictions is null (e.g. free tier, or the row hasn't
 * resolved) are omitted, so callers can treat "absent from map" as "no summary".
 */
export function buildAdvisorSummaryMap(
  advisorBikes: readonly AdvisorBikeRow[] | undefined
): Map<string, AdvisorSummary | null> {
  const map = new Map<string, AdvisorSummary | null>();
  for (const b of advisorBikes ?? []) {
    if (b.advisorPredictions) map.set(b.id, b.advisorPredictions.advisorSummary ?? null);
  }
  return map;
}

/**
 * Attach each bike's advisor summary (fetched separately, off the dashboard
 * critical path) onto its predictions, so the hero/switcher can read
 * predictions.advisorSummary as usual.
 *
 * Returns the input array unchanged when there's nothing to merge. Bikes
 * without predictions, or not present in the map, are left untouched — the
 * base BIKES query never selects advisorSummary, so it only ever comes from
 * `byBikeId`.
 */
export function mergeAdvisorSummaries(
  bikes: readonly BikeWithPredictions[],
  byBikeId: Map<string, AdvisorSummary | null>
): BikeWithPredictions[] {
  if (byBikeId.size === 0) return bikes as BikeWithPredictions[];
  return bikes.map((bike) =>
    bike.predictions
      ? {
          ...bike,
          predictions: {
            ...bike.predictions,
            advisorSummary: byBikeId.get(bike.id) ?? null,
          },
        }
      : bike
  );
}
