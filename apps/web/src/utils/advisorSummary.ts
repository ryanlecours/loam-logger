import type { AdvisorSummary } from '../types/prediction';
import type { BikeWithPredictions } from '../hooks/usePriorityBike';

/**
 * A row from the BIKES_ADVISOR query. Its `predictions` merges into the
 * bikeId-normalized cache entity BIKES wrote (see graphql/bikes.ts and the
 * typePolicy in lib/apolloClient.ts).
 */
export interface AdvisorBikeRow {
  id: string;
  predictions: { bikeId: string; advisorSummary: AdvisorSummary | null } | null;
}

/**
 * Build a bikeId -> advisorSummary lookup from the advisor query result.
 * Bikes whose predictions is null (e.g. free tier, or the row hasn't resolved)
 * are omitted, so callers can treat "absent from map" as "no summary".
 */
export function buildAdvisorSummaryMap(
  advisorBikes: readonly AdvisorBikeRow[] | undefined
): Map<string, AdvisorSummary | null> {
  const map = new Map<string, AdvisorSummary | null>();
  for (const b of advisorBikes ?? []) {
    if (b.predictions) map.set(b.id, b.predictions.advisorSummary ?? null);
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
