import { gql } from '@apollo/client';

export const DELETE_RIDE = gql`
  mutation DeleteRide($id: ID!) {
    deleteRide(id: $id) { ok id }
  }
`;
