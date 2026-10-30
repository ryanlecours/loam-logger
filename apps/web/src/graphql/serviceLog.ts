import { gql } from '@apollo/client';

export const UPDATE_SERVICE_LOG = gql`
  mutation UpdateServiceLog($id: ID!, $input: UpdateServiceLogInput!) {
    updateServiceLog(id: $id, input: $input) {
      id
      performedAt
      notes
      hoursAtService
      costMinor
      currency
      parts {
        id
        brand
        model
        priceMinor
        vendor
      }
    }
  }
`;

export const DELETE_SERVICE_LOG = gql`
  mutation DeleteServiceLog($id: ID!) {
    deleteServiceLog(id: $id)
  }
`;
