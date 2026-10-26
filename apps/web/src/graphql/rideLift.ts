import { gql } from '@apollo/client';

// The lift summary, shared by the rides list (for the row tag) and the ride
// panel. Both select the same fields: RideLift has no id, so the cache stores
// it inside its Ride, and two queries selecting different subsets would each
// overwrite the other's copy.
export const LIFT_FIELDS = gql`
  fragment LiftFields on RideLift {
    elevationGainMeters
    countElevation
    countElevationChoice
    segments {
      startTime
      liftName
      kind
    }
  }
`;

// Lifts detected on one ride and the rider's choice about their climb.
const RIDE_LIFT_FIELDS = gql`
  fragment RideLiftFields on Ride {
    id
    elevationGainMeters
    countedElevationGainMeters
    lift {
      ...LiftFields
    }
  }
  ${LIFT_FIELDS}
`;

export const RIDE_LIFT = gql`
  query RideLift($id: ID!) {
    ride(id: $id) {
      ...RideLiftFields
    }
  }
  ${RIDE_LIFT_FIELDS}
`;

// Returns the same fields so the normalized Ride (and with it the rides list
// and the stats computed from it) picks up the new counted climb.
export const SET_RIDE_LIFT_ELEVATION = gql`
  mutation SetRideLiftElevation($rideId: ID!, $count: Boolean) {
    setRideLiftElevation(rideId: $rideId, count: $count) {
      ...RideLiftFields
    }
  }
  ${RIDE_LIFT_FIELDS}
`;
