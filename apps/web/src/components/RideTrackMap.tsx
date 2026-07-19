import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { RIDE_TRACK, REQUEST_RIDE_TRACK } from '../graphql/rideTrack';
import { Button } from './ui';

const TrackMapInner = lazy(() => import('./TrackMapInner'));

type RideTrack = {
  status: 'AVAILABLE' | 'FETCHABLE' | 'UNAVAILABLE';
  points: [number, number][] | null;
  sampledFrom: number | null;
};

const POLL_INTERVAL_MS = 2_500;
// Stream fetch is a queued job with retries; give it a generous window
// before telling the user to come back later.
const POLL_TIMEOUT_MS = 90_000;

const MapSkeleton = () => (
  <div className="h-56 w-full animate-pulse rounded-lg bg-surface-2" aria-hidden="true" />
);

/**
 * Route map for one ride. Self-hides for rides with no GPS source; offers a
 * one-tap "Load route map" for Strava rides imported before stream ingestion
 * existed (fetches on demand, then polls until the track lands).
 */
export default function RideTrackMap({ rideId }: { rideId: string }) {
  const { data, loading, startPolling, stopPolling } = useQuery<{ rideTrack: RideTrack }>(
    RIDE_TRACK,
    { variables: { rideId }, fetchPolicy: 'cache-and-network' }
  );
  const [requestTrack, { loading: requesting, error: requestError }] = useMutation(
    REQUEST_RIDE_TRACK,
    { variables: { rideId } }
  );

  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = data?.rideTrack;

  // Stop polling as soon as the track lands (or on unmount).
  useEffect(() => {
    if (waiting && track?.status === 'AVAILABLE') {
      stopPolling();
      setWaiting(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [waiting, track?.status, stopPolling]);

  useEffect(
    () => () => {
      stopPolling();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [stopPolling]
  );

  const handleLoadMap = async () => {
    setTimedOut(false);
    try {
      await requestTrack();
    } catch {
      return; // surfaced via requestError
    }
    setWaiting(true);
    startPolling(POLL_INTERVAL_MS);
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setWaiting(false);
      setTimedOut(true);
    }, POLL_TIMEOUT_MS);
  };

  if (!track) {
    return loading ? <MapSkeleton /> : null;
  }

  if (track.status === 'AVAILABLE' && track.points?.length) {
    return (
      <Suspense fallback={<MapSkeleton />}>
        <TrackMapInner points={track.points} />
      </Suspense>
    );
  }

  if (track.status === 'FETCHABLE') {
    return (
      <div className="flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border">
        {waiting ? (
          <span className="text-sm text-muted">Loading route from Strava…</span>
        ) : (
          <Button type="button" variant="secondary" onClick={handleLoadMap} disabled={requesting}>
            {requesting ? 'Requesting…' : 'Load route map'}
          </Button>
        )}
        {timedOut && (
          <span className="text-xs text-muted">
            Still working on it — check back in a minute.
          </span>
        )}
        {requestError && <span className="text-xs text-danger">{requestError.message}</span>}
      </div>
    );
  }

  return null; // UNAVAILABLE: no GPS source, nothing to show
}
