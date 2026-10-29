import { useEffect, useState } from 'react';
import { gql, useQuery } from '@apollo/client';
import type { RideSourceData } from '../utils/rideSourceState';

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
  // Polling follows the data: it starts when an import appears and stops once
  // the import settles or a ride lands. Without it a rider who has just
  // connected would stare at "importing" until a reload.
  const [pollInterval, setPollInterval] = useState(0);
  const result = useQuery<RideSourceQueryData>(RIDE_SOURCE, {
    fetchPolicy: 'cache-and-network',
    pollInterval,
  });

  const rideSource = result.data?.me?.rideSource ?? null;
  const status = rideSource?.autoImport?.status;
  const shouldPoll = (status === 'PENDING' || status === 'RUNNING') && rideSource?.rideCount === 0;

  useEffect(() => {
    setPollInterval(shouldPoll ? RIDE_SOURCE_POLL_MS : 0);
  }, [shouldPoll]);

  return { rideSource, loading: result.loading, error: result.error, refetch: result.refetch };
}
