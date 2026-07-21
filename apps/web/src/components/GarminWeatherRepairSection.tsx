import { useState } from 'react';
import { useApolloClient, useMutation, useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { Mountain, Lock } from 'lucide-react';
import { useUserTier } from '../hooks/useUserTier';
import {
  BACKFILL_GARMIN_WEATHER,
  GARMIN_RIDES_MISSING_COORDS,
} from '../graphql/backfillGarminWeather';
import { RIDES } from '../graphql/rides';

type BackfillStatus = 'STARTED' | 'ALREADY_RUNNING' | 'NOT_CONNECTED' | 'NOTHING_TO_DO';

// Garmin rides imported before the coordinate fix have no location data, so
// they never got weather. This prompt lets the user re-import them from Garmin
// (server-side throttled); Garmin re-delivers the activities and weather fills
// in as they process.
export default function GarminWeatherRepairSection() {
  const { isPro } = useUserTier();
  const apolloClient = useApolloClient();
  const navigate = useNavigate();
  const { data } = useQuery<{ me: { id: string; garminRidesMissingCoords: number } | null }>(
    GARMIN_RIDES_MISSING_COORDS,
    { fetchPolicy: 'cache-and-network' }
  );
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [backfill, { loading }] = useMutation(BACKFILL_GARMIN_WEATHER, {
    refetchQueries: [{ query: GARMIN_RIDES_MISSING_COORDS }],
  });

  const missing = data?.me?.garminRidesMissingCoords ?? 0;

  // Nothing to repair and nothing to report → render nothing.
  if (missing === 0 && status === null) return null;

  const onClick = async () => {
    if (!isPro) {
      navigate('/pricing');
      return;
    }
    setError(null);
    try {
      const { data: res } = await backfill();
      const next = (res?.backfillGarminWeather?.status ?? null) as BackfillStatus | null;
      setStatus(next);
      // Rides trickle back via Garmin webhooks; refetch the list a bit later so
      // the new weather tiles show up without a manual reload.
      if (next === 'STARTED' || next === 'ALREADY_RUNNING') {
        setTimeout(() => {
          apolloClient.refetchQueries({ include: [RIDES] }).catch(() => {});
        }, 30_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const inProgress = status === 'STARTED' || status === 'ALREADY_RUNNING';

  const message = (() => {
    switch (status) {
      case 'STARTED':
      case 'ALREADY_RUNNING':
        return "Re-importing from Garmin. Weather will appear as your rides come back — this can take a few minutes.";
      case 'NOT_CONNECTED':
        return 'Connect your Garmin account to import weather for past rides.';
      case 'NOTHING_TO_DO':
        return 'All your Garmin rides already have location data.';
      default:
        return `${missing} Garmin ride${missing === 1 ? '' : 's'} imported without location data, so ${missing === 1 ? 'it has' : 'they have'} no weather. Re-import from Garmin to fix.`;
    }
  })();

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white">Garmin Weather</h3>
      <div className="rounded-2xl border border-app/60 bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Mountain className="h-5 w-5 text-muted" />
            <div>
              <p className="text-sm font-medium text-white">Weather for past Garmin rides</p>
              <p className="text-xs text-muted">{message}</p>
            </div>
          </div>
          {isPro ? (
            <button
              onClick={onClick}
              disabled={loading || inProgress || status === 'NOTHING_TO_DO'}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? 'Starting…' : inProgress ? 'Importing…' : 'Re-import'}
            </button>
          ) : (
            <button
              onClick={onClick}
              className="flex items-center gap-1.5 rounded-lg border border-mint/30 bg-mint/15 px-3 py-1.5 text-xs font-medium text-mint transition hover:bg-mint/25"
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
