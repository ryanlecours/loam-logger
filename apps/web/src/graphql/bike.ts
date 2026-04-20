import { gql } from '@apollo/client';

export const UPDATE_BIKE_ACQUISITION = gql`
  mutation UpdateBikeAcquisition(
    $bikeId: ID!
    $input: UpdateBikeAcquisitionInput!
  ) {
    updateBikeAcquisition(bikeId: $bikeId, input: $input) {
      bike {
        id
        acquisitionDate
      }
      installsMoved
      serviceLogsMoved
    }
  }
`;

export const BULK_UPDATE_BIKE_COMPONENT_INSTALLS = gql`
  mutation BulkUpdateBikeComponentInstalls(
    $input: BulkUpdateBikeComponentInstallsInput!
  ) {
    bulkUpdateBikeComponentInstalls(input: $input) {
      updatedCount
      serviceLogsMoved
    }
  }
`;
