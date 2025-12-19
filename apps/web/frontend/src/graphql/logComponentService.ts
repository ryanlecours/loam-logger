import { gql } from '@apollo/client';

export const LOG_COMPONENT_SERVICE = gql`
  mutation LogComponentService($id: ID!) {
    logComponentService(id: $id) {
      id
      hoursUsed
      updatedAt
    }
  }
`;
