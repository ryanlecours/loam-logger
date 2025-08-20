import { gql } from '@apollo/client';

export const UPDATE_RIDE = gql`
  mutation UpdateRide($id: ID!, $input: UpdateRideInput!) {
    updateRide(id: $id, input: $input) {
      id
      startTime
      durationSeconds
      distanceMiles
      elevationGainFeet
      averageHr
      rideType
      bikeId
      notes
      trailSystem
      location
      updatedAt
    }
  }
`;
