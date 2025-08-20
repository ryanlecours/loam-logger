import { gql } from '@apollo/client';

export const BIKES = gql`
  query Bikes {
    bikes {
      id
      manufacturer
      model
      nickname
      pivotHoursSinceService
      isComplete
      components {
        id
        type
        manufacturer
        model
        year
        hoursSinceService
      }
    }
  }
`;

export const ADD_BIKE = gql`
  mutation AddBike($input: AddBikeInput!) {
    addBike(input: $input) {
      id
      manufacturer
      model
      nickname
      createdAt
      updatedAt
    }
  }
`;
