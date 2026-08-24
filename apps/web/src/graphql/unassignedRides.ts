import { gql, useQuery, useLazyQuery } from '@apollo/client';
import type { RideSource } from '../utils/rideSource';

/**
 * The GraphQL RideProvider enum. Uppercase on the wire; the rest of the web app
 * talks in lowercase RideSource strings, so the two are mapped rather than
 * merged. Note this is the *exclusive* bucket rule (a Garmin ride imported via
 * Strava is filed under Strava), which is deliberately not how the attribution
 * badges behave.
 */
export type RideProvider = 'STRAVA' | 'GARMIN' | 'WHOOP' | 'SUUNTO' | 'MANUAL';

export const PROVIDER_FROM_SOURCE: Record<RideSource, RideProvider> = {
  strava: 'STRAVA',
  garmin: 'GARMIN',
  whoop: 'WHOOP',
  suunto: 'SUUNTO',
  manual: 'MANUAL',
};

export type UnassignedRideFilter = {
  startDate?: string | null;
  endDate?: string | null;
  provider?: RideProvider | null;
};

export const UNASSIGNED_RIDE_SUMMARY = gql`
  query UnassignedRideSummary($filter: UnassignedRideFilterInput) {
    unassignedRideSummary(filter: $filter) {
      totalCount
      totalDurationSeconds
      earliestStartTime
      latestStartTime
      byProvider {
        provider
        count
      }
    }
  }
`;

/**
 * The ids a bulk assignment will act on, fetched at submit time rather than
 * carried along from the preview: a ride can pick up a bike from a webhook
 * between the two, and assignBikeToRides rejects the whole batch if one has.
 *
 * Selects nothing but ids on purpose. The count can run to thousands and the
 * mutation needs no other field.
 */
export const UNASSIGNED_RIDE_IDS = gql`
  query UnassignedRideIds($filter: RidesFilterInput, $take: Int) {
    rides(filter: $filter, take: $take) {
      id
    }
  }
`;

export type ProviderRideCount = {
  provider: RideProvider;
  count: number;
};

export type UnassignedRideSummary = {
  totalCount: number;
  totalDurationSeconds: number;
  earliestStartTime: string | null;
  latestStartTime: string | null;
  byProvider: ProviderRideCount[];
};

export function useUnassignedRideSummary(
  filter: UnassignedRideFilter,
  options?: { skip?: boolean }
) {
  return useQuery<{ unassignedRideSummary: UnassignedRideSummary }>(UNASSIGNED_RIDE_SUMMARY, {
    variables: { filter },
    skip: options?.skip,
    fetchPolicy: 'cache-and-network',
  });
}

export function useUnassignedRideIds() {
  return useLazyQuery<{ rides: { id: string }[] }>(UNASSIGNED_RIDE_IDS, {
    // Never the cache: a stale id list is exactly what this call exists to
    // avoid.
    fetchPolicy: 'network-only',
  });
}
