import { gql } from '@apollo/client';

export const WEATHER_BREAKDOWN = gql`
  query WeatherBreakdown($filter: RidesFilterInput) {
    me {
      id
      weatherBreakdown(filter: $filter) {
        sunny
        cloudy
        rainy
        snowy
        windy
        foggy
        unknown
        pending
        totalRides
      }
    }
  }
`;
