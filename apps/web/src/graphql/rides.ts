import { gql } from '@apollo/client';

export const RIDES = gql`
  query Rides($take: Int, $after: ID, $filter: RidesFilterInput) {
    rides(take: $take, after: $after, filter: $filter) {
      id
      garminActivityId
      stravaActivityId
      whoopWorkoutId
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
      weather {
        tempC
        feelsLikeC
        precipitationMm
        windSpeedKph
        wmoCode
        condition
      }
    }
  }
`;
