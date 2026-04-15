import { gql } from '@apollo/client';

// Weather is included in the rides list because RideStatsCard's weather
// breakdown needs it for every ride in the selected timeframe. The edit
// modal also reads it via the cached Ride — so both consumers get it from
// one query. If ride-list payload size ever becomes an issue, the weather
// fragment is the first thing to hoist into a lazy per-ride query.
const RIDE_WEATHER_FIELDS = gql`
  fragment RideWeatherFields on RideWeather {
    id
    tempC
    feelsLikeC
    precipitationMm
    windSpeedKph
    humidity
    wmoCode
    condition
  }
`;

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
        ...RideWeatherFields
      }
    }
  }
  ${RIDE_WEATHER_FIELDS}
`;
