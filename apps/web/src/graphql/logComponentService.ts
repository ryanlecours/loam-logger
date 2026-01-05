import { gql } from '@apollo/client';

export const LOG_COMPONENT_SERVICE = gql`
  mutation LogComponentService($id: ID!, $performedAt: String) {
    logComponentService(id: $id, performedAt: $performedAt) {
      id
      hoursUsed
      updatedAt
    }
  }
`;
