import { gql, useQuery, useMutation } from '@apollo/client';

export const IMPORT_NOTIFICATION_STATE = gql`
  query ImportNotificationState {
    importNotificationState {
      showOverlay
      sessionId
      unassignedRideCount
      totalImportedCount
    }
  }
`;

export const UNASSIGNED_RIDES = gql`
  query UnassignedRides($importSessionId: ID!, $take: Int, $after: ID) {
    unassignedRides(importSessionId: $importSessionId, take: $take, after: $after) {
      rides {
        id
        startTime
        durationSeconds
        distanceMiles
        elevationGainFeet
        location
        rideType
      }
      totalCount
      hasMore
    }
  }
`;

export const ACKNOWLEDGE_IMPORT_OVERLAY = gql`
  mutation AcknowledgeImportOverlay($importSessionId: ID!) {
    acknowledgeImportOverlay(importSessionId: $importSessionId) {
      success
    }
  }
`;

export const ASSIGN_BIKE_TO_RIDES = gql`
  mutation AssignBikeToRides($rideIds: [ID!]!, $bikeId: ID!) {
    assignBikeToRides(rideIds: $rideIds, bikeId: $bikeId) {
      success
      updatedCount
    }
  }
`;

export type ImportNotificationState = {
  showOverlay: boolean;
  sessionId: string | null;
  unassignedRideCount: number;
  totalImportedCount: number;
};

export type UnassignedRide = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  location: string | null;
  rideType: string;
};

export type UnassignedRidesPage = {
  rides: UnassignedRide[];
  totalCount: number;
  hasMore: boolean;
};

export function useImportNotificationState(options?: { pollInterval?: number }) {
  return useQuery<{ importNotificationState: ImportNotificationState }>(
    IMPORT_NOTIFICATION_STATE,
    {
      pollInterval: options?.pollInterval ?? 30000, // Default: poll every 30 seconds
      fetchPolicy: 'network-only',
    }
  );
}

export function useUnassignedRides(importSessionId: string | null, take = 50) {
  return useQuery<{ unassignedRides: UnassignedRidesPage }>(UNASSIGNED_RIDES, {
    variables: { importSessionId, take },
    skip: !importSessionId,
    fetchPolicy: 'cache-and-network',
  });
}

export function useAcknowledgeImportOverlay() {
  return useMutation<{ acknowledgeImportOverlay: { success: boolean } }>(
    ACKNOWLEDGE_IMPORT_OVERLAY,
    {
      refetchQueries: [{ query: IMPORT_NOTIFICATION_STATE }],
    }
  );
}

export function useAssignBikeToRides() {
  return useMutation<
    { assignBikeToRides: { success: boolean; updatedCount: number } },
    { rideIds: string[]; bikeId: string }
  >(ASSIGN_BIKE_TO_RIDES, {
    refetchQueries: [{ query: IMPORT_NOTIFICATION_STATE }],
  });
}
