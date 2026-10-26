import { gql } from '@apollo/client';

// Lifts detected on one ride and the rider's choice about their climb. Read
// lazily when a ride is opened; the rides list only carries the counted climb.
const RIDE_LIFT_FIELDS = gql`
  fragment RideLiftFields on Ride {
    id
    elevationGainMeters
    countedElevationGainMeters
    lift {
      elevationGainMeters
      countElevation
      countElevationChoice
      segments {
        startTime
        liftName
        kind
      }
    }
  }
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
