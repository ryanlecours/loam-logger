import { useEffect } from 'react';
import { gql, useQuery } from '@apollo/client';
import { isRideSourceSettling, resolveRideSourceState, type RideSourceData } from '../utils/rideSourceState';

/**
 * Where the rider's hours come from. Selected on its own rather than added to
 * ME_QUERY: it costs three reads on the server, and only the dashboard needs
 * the answer.
 */
export const RIDE_SOURCE = gql`
  query RideSource {
    me {
      id
      rideSource {
        connectedProviders
        rideCount
        autoImport {
          provider
          status
          ridesFound
          lookbackDays
          startedAt
          completedAt
        }
      }
    }
  }
`;

interface RideSourceQueryData {
  me: { id: string; rideSource: RideSourceData } | null;
}

/** Poll this often while an import is running, matching the import checker's cadence. */
export const RIDE_SOURCE_POLL_MS = 30_000;

export function useRideSource() {
  const { data, loading, error, refetch, startPolling, stopPolling } = useQuery<RideSourceQueryData>(
    RIDE_SOURCE,
    { fetchPolicy: 'cache-and-network' }
  );

  const rideSource = data?.me?.rideSource ?? null;

  // Polling follows the data: it starts when an import appears and stops once
  // the import settles or a ride lands. Without it a rider who has just
  // connected would stare at "importing" until a reload. The server's stale
  // sweep fails a request with no progress for an hour, so this cannot poll
  // forever against a stuck row. Decided by the same helper the card uses so
  // the two cannot drift.
  const settling = isRideSourceSettling(
    rideSource ? resolveRideSourceState({ ...rideSource, manualOnly: false }) : null
  );
  useEffect(() => {
    if (!settling) return;
    startPolling(RIDE_SOURCE_POLL_MS);
    return () => stopPolling();
  }, [settling, startPolling, stopPolling]);

  return { rideSource, loading, error, refetch };
}
