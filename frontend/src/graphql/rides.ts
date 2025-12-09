import { gql } from '@apollo/client';

export const RIDES = gql`
  query Rides($take: Int, $after: ID) {
    rides(take: $take, after: $after) {
      id
      garminActivityId
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
    }
  }
`;
