import { gql } from '@apollo/client';

export const BACKFILL_WEATHER_FOR_MY_RIDES = gql`
  mutation BackfillWeatherForMyRides {
    backfillWeatherForMyRides {
      enqueuedCount
      ridesWithoutCoords
      remainingAfterBatch
    }
  }
`;

export const RIDES_MISSING_WEATHER = gql`
  query RidesMissingWeather {
    ridesMissingWeather
  }
`;
