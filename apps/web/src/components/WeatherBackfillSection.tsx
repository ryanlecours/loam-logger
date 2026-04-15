import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { CloudSun, Lock } from 'lucide-react';
import { useUserTier } from '../hooks/useUserTier';
import { useViewer, ME_QUERY } from '../graphql/me';
import { BACKFILL_WEATHER_FOR_MY_RIDES } from '../graphql/backfillWeather';

export default function WeatherBackfillSection() {
  const { isPro } = useUserTier();
  const { viewer } = useViewer();
  const navigate = useNavigate();
  const [queued, setQueued] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [backfill, { loading }] = useMutation(BACKFILL_WEATHER_FOR_MY_RIDES, {
    refetchQueries: [{ query: ME_QUERY }],
  });

  const missing = viewer?.ridesMissingWeather ?? 0;

  if (missing === 0 && queued === null) return null;

  const onClick = async () => {
    if (!isPro) {
      navigate('/pricing');
      return;
    }
    setError(null);
    try {
      const { data } = await backfill();
      setQueued(data?.backfillWeatherForMyRides?.enqueuedCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

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
                {queued !== null
                  ? `Queued ${queued} ride${queued === 1 ? '' : 's'}. Weather will appear as it's fetched.`
                  : `${missing} ride${missing === 1 ? '' : 's'} missing weather data.`}
              </p>
            </div>
          </div>
          {isPro ? (
            <button
              onClick={onClick}
              disabled={loading || queued !== null}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? 'Queuing…' : queued !== null ? 'Queued' : 'Fetch weather'}
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
