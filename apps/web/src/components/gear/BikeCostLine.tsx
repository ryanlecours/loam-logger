import { useQuery } from '@apollo/client';

import { BIKE_COST_SUMMARY } from '@/graphql/bike';
import { useUserTier } from '@/hooks/useUserTier';
import { useCostInsightViewed } from '@/hooks/useCostInsightViewed';
import { fmtMoney, fmtPerHour } from '@/lib/money';
import type { BikeCostSummary } from '@/lib/bikeHistory';
import { ProChip } from '@/components/UpgradePrompt';

type Payload = { bike: { id: string; costSummary: BikeCostSummary | null } | null };

/**
 * One line under the bike's status row: "Spent $1,240 · $2.10 per ride hour
 * · since 2025". Pro only on the server; Free riders see the question and
 * the quiet Pro chip (the bike page's UpsellCard slot is spoken for).
 */
export function BikeCostLine({ bikeId }: { bikeId: string }) {
  const { isPro } = useUserTier();
  const { data } = useQuery<Payload>(BIKE_COST_SUMMARY, {
    variables: { id: bikeId },
    skip: !isPro,
    fetchPolicy: 'cache-and-network',
  });
  const summary = data?.bike?.costSummary ?? null;
  useCostInsightViewed('bike', !isPro || summary != null);

  if (!isPro) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        What does this bike cost to ride?
        <ProChip source="bike-cost-per-hour" />
      </p>
    );
  }

  if (!summary) return null;
  if (summary.totalMinor === 0 && summary.bikeMinor == null) {
    return (
      <p className="text-xs text-muted">
        Nothing spent on record yet. Add what a service or part cost when you log it.
      </p>
    );
  }

  const since = summary.byYear.length > 0 ? Math.min(...summary.byYear.map((y) => y.year)) : null;
  const pieces = [
    `Spent ${fmtMoney(summary.totalMinor, summary.currency)}`,
    summary.perHourMinor != null ? `${fmtPerHour(summary.perHourMinor, summary.currency).replace(' / h', '')} per ride hour` : null,
    since != null ? `since ${since}` : null,
  ].filter(Boolean);

  return (
    <p className="text-xs text-app">
      {pieces.join(' · ')}
      {summary.otherCurrencyCount > 0 && (
        <span className="text-muted">
          {' '}
          · {summary.otherCurrencyCount} in another currency not included
        </span>
      )}
    </p>
  );
}
