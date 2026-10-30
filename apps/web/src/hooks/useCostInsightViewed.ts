import { useEffect } from 'react';
import { posthog } from '../lib/posthog';
import { useUserTier } from './useUserTier';

export type CostInsightSurface = 'component' | 'bike' | 'history';

/**
 * Fires `cost_insight_viewed` once per mount when a cost summary, or the Pro
 * chip standing in for one, renders. Read beside `pricing_page_viewed`
 * (source `cost_per_hour`) to see whether the gated number leads anywhere.
 */
export function useCostInsightViewed(surface: CostInsightSurface, ready: boolean): void {
  const { tier } = useUserTier();
  useEffect(() => {
    if (!ready) return;
    posthog.capture('cost_insight_viewed', { surface, tier });
  }, [ready, surface, tier]);
}
