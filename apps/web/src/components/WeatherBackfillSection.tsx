import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { CloudSun, Lock } from 'lucide-react';
import { useUserTier } from '../hooks/useUserTier';
import {
  BACKFILL_WEATHER_FOR_MY_RIDES,
  RIDES_MISSING_WEATHER,
} from '../graphql/backfillWeather';
import { RIDES } from '../graphql/rides';
import { useApolloClient } from '@apollo/client';

export default function WeatherBackfillSection() {
  const { isPro } = useUserTier();
  const apolloClient = useApolloClient();
  const { data: countData } = useQuery<{ me: { id: string; ridesMissingWeather: number } | null }>(
    RIDES_MISSING_WEATHER,
    { fetchPolicy: 'cache-and-network' }
  );
  const navigate = useNavigate();
  const [lastResult, setLastResult] = useState<{
    enqueued: number;
    remaining: number;
    withoutCoords: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [backfill, { loading }] = useMutation(BACKFILL_WEATHER_FOR_MY_RIDES, {
    refetchQueries: [{ query: RIDES_MISSING_WEATHER }],
  });

  const missing = countData?.me?.ridesMissingWeather ?? 0;

  if (missing === 0 && lastResult === null) return null;

  const onClick = async () => {
    if (!isPro) {
      navigate('/pricing');
      return;
    }
    setError(null);
    try {
      const { data } = await backfill();
      const res = data?.backfillWeatherForMyRides;
      setLastResult({
        enqueued: res?.enqueuedCount ?? 0,
        remaining: res?.remainingAfterBatch ?? 0,
        withoutCoords: res?.ridesWithoutCoords ?? 0,
      });
      // The queue drains asynchronously. Refetch the rides list once workers
      // have had a chance to populate weather rows so the freshly-fetched
      // weather tiles actually appear without a manual page reload. The
      // window is a heuristic; stragglers catch up on next navigation via
      // the list query's cache-and-network fetch policy.
      if ((res?.enqueuedCount ?? 0) > 0) {
        setTimeout(() => {
          apolloClient.refetchQueries({ include: [RIDES] }).catch(() => {});
        }, 15_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const hasMore = (lastResult?.remaining ?? 0) > 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white">Weather Data</h3>
      <div className="rounded-2xl border border-app/60 bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CloudSun className="h-5 w-5 text-muted" />
            <div>
              <p className="text-sm font-medium text-white">Weather for past rides</p>
              <p className="text-xs text-muted">
                {lastResult !== null
                  ? hasMore
                    ? `Queued ${lastResult.enqueued} ride${lastResult.enqueued === 1 ? '' : 's'}. ${lastResult.remaining} more remain — click Fetch more when these finish.`
                    : `Queued ${lastResult.enqueued} ride${lastResult.enqueued === 1 ? '' : 's'}. Weather will appear as it's fetched.`
                  : `${missing} ride${missing === 1 ? '' : 's'} missing weather data.`}
              </p>
              {lastResult !== null && lastResult.withoutCoords > 0 && (
                <p className="text-xs text-muted mt-1">
                  {lastResult.withoutCoords} ride
                  {lastResult.withoutCoords === 1 ? '' : 's'} can't get weather —
                  no GPS data on file.
                </p>
              )}
            </div>
          </div>
          {isPro ? (
            <button
              onClick={onClick}
              disabled={loading || (lastResult !== null && !hasMore)}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {loading
                ? 'Queuing…'
                : lastResult === null
                  ? 'Fetch weather'
                  : hasMore
                    ? 'Fetch more'
                    : 'Queued'}
            </button>
          ) : (
            <button
              onClick={onClick}
              className="flex items-center gap-1.5 rounded-lg bg-mint/15 border border-mint/30 px-3 py-1.5 text-xs font-medium text-mint transition hover:bg-mint/25"
            >
              <Lock className="h-3 w-3" />
              Pro feature
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
