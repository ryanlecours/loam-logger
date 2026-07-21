import { gql } from '@apollo/client';

// The rides behind a component's current hoursUsed number, per the canonical
// attribution rule (rides on the component's bike since the last-service
// anchor, ± per-ride adjustments). Cursor-paged newest first.
export const COMPONENT_RIDES = gql`
  query ComponentRides($componentId: ID!, $take: Int, $after: ID) {
    componentRides(componentId: $componentId, take: $take, after: $after) {
      componentId
      anchor
      countedHours
      hoursUsed
      countedRideCount
      hasMore
      entries {
        counted
        adjustment
        beforeAnchor
        ride {
          id
          startTime
          durationSeconds
          distanceMeters
          location
          trailSystem
          rideType
          bikeId
        }
      }
    }
  }
`;

// Both mutations return the fresh component so Apollo renormalizes
// Component.hoursUsed everywhere it's displayed.
export const SET_COMPONENT_RIDE_ADJUSTMENT = gql`
  mutation SetComponentRideAdjustment($componentId: ID!, $rideId: ID!, $kind: ComponentRideAdjustmentKind!) {
    setComponentRideAdjustment(componentId: $componentId, rideId: $rideId, kind: $kind) {
      component {
        id
        hoursUsed
      }
      rideId
      counted
    }
  }
`;

export const CLEAR_COMPONENT_RIDE_ADJUSTMENT = gql`
  mutation ClearComponentRideAdjustment($componentId: ID!, $rideId: ID!) {
    clearComponentRideAdjustment(componentId: $componentId, rideId: $rideId) {
      component {
        id
        hoursUsed
      }
      rideId
      counted
    }
  }
`;
