import { gql } from '@apollo/client';

export const BACKFILL_WEATHER_FOR_MY_RIDES = gql`
  mutation BackfillWeatherForMyRides {
    backfillWeatherForMyRides {
      enqueuedCount
      ridesWithoutCoords
    }
  }
`;
