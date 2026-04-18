import { gql } from '@apollo/client';

export const UPDATE_SERVICE_LOG = gql`
  mutation UpdateServiceLog($id: ID!, $input: UpdateServiceLogInput!) {
    updateServiceLog(id: $id, input: $input) {
      id
      performedAt
      notes
      hoursAtService
    }
  }
`;

export const DELETE_SERVICE_LOG = gql`
  mutation DeleteServiceLog($id: ID!) {
    deleteServiceLog(id: $id)
  }
`;
