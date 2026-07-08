import type { BikePredictionSummary, ComponentPrediction } from './types';

/**
 * A ComponentPrediction with the Pro-only predictive fields nulled.
 * Raw usage (currentHours, serviceIntervalHours, hoursSinceService,
 * ridesSinceService) and identity fields are preserved for all tiers.
 */
export type DegradedComponentPrediction = Omit<
  ComponentPrediction,
  'status' | 'hoursRemaining' | 'ridesRemainingEstimate' | 'confidence' | 'why' | 'drivers'
> & {
  status: null;
  hoursRemaining: null;
  ridesRemainingEstimate: null;
  confidence: null;
  why: null;
  drivers: null;
};

export type DegradedBikePredictionSummary = Omit<
  BikePredictionSummary,
  'components' | 'priorityComponent' | 'overallStatus' | 'dueSoonCount'
> & {
  components: DegradedComponentPrediction[];
  priorityComponent: null;
  overallStatus: null;
  dueSoonCount: null;
};

/**
 * Strip the Pro-only predictive fields from a bike prediction summary.
 *
 * Free users keep the raw usage counters and a binary READY / NOT READY
 * signal (`dueNowCount`) so the dashboard tile can render without leaking
 * the Pro-only due-soon lookahead. Remaining-life estimates, per-component
 * due statuses, and wear explanations stay Pro-only. Applied at the serving
 * boundary (GraphQL resolver) so the engine, cache, and notification paths
 * keep working with full summaries.
 */
export function degradeSummaryForFreeTier(
  summary: BikePredictionSummary
): DegradedBikePredictionSummary {
  return {
    ...summary,
    components: summary.components.map((c) => ({
      ...c,
      status: null,
      hoursRemaining: null,
      ridesRemainingEstimate: null,
      confidence: null,
      why: null,
      drivers: null,
    })),
    priorityComponent: null,
    overallStatus: null,
    dueSoonCount: null,
  };
}
