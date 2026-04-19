import { gql } from '@apollo/client';

export const UPDATE_BIKE_COMPONENT_INSTALL = gql`
  mutation UpdateBikeComponentInstall($id: ID!, $input: UpdateBikeComponentInstallInput!) {
    updateBikeComponentInstall(id: $id, input: $input) {
      id
      installedAt
      removedAt
    }
  }
`;

export const DELETE_BIKE_COMPONENT_INSTALL = gql`
  mutation DeleteBikeComponentInstall($id: ID!) {
    deleteBikeComponentInstall(id: $id)
  }
`;
