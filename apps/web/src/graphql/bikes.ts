import { gql } from '@apollo/client';

export const BIKES = gql`
  query Bikes {
    bikes {
      id
      nickname
      manufacturer
      model
      thumbnailUrl
      travelForkMm
      travelShockMm
      notes
      fork {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      shock {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      pivotBearings {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      components {
        id
        type
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
    }
  }
`;
