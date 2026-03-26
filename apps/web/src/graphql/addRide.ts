import { gql } from '@apollo/client';

export const ADD_RIDE = gql`
  mutation AddRide($input: AddRideInput!) {
    addRide(input: $input) {
      id
      startTime
      durationSeconds
      distanceMeters
      elevationGainMeters
      averageHr
      rideType
      bikeId
      notes
      trailSystem
      location
    }
  }
`;
