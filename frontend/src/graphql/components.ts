import { gql } from '@apollo/client';

export const UPSERT_BIKE_COMPONENT = gql`
  mutation UpsertBikeComponent($input: UpsertBikeComponentInput!) {
    upsertBikeComponent(input: $input) {
      id
      bikeId
      type
      manufacturer
      model
      year
      hoursSinceService
      lastServicedAt
      updatedAt
    }
  }
`;

export const MARK_COMPONENT_SERVICED = gql`
  mutation MarkComponentServiced($componentId: ID!) {
    markComponentServiced(componentId: $componentId) {
      id
      hoursSinceService
      lastServicedAt
      updatedAt
    }
  }
`;

export const MARK_BIKE_PIVOT_SERVICED = gql`
  mutation MarkBikePivotServiced($bikeId: ID!) {
    markBikePivotServiced(bikeId: $bikeId) {
      id
      pivotHoursSinceService
      pivotLastServicedAt
      updatedAt
    }
  }
`;
