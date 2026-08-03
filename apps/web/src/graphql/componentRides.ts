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
          # Provider ids drive the per-ride source badges. Garmin in particular
          # must be attributed wherever its device-sourced data appears (the
          # Garmin API Brand Guidelines require attribution on secondary/detail
          # views, not just primary feeds), and garminDeviceName carries the
          # sanctioned "Garmin [device model]" label.
          garminActivityId
          garminDeviceName
          stravaActivityId
          whoopWorkoutId
          suuntoWorkoutId
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
