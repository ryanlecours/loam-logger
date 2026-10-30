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

// The bike page's one-line cost summary. Pro only on the server (null for
// Free), so callers skip it for Free riders rather than asking for a null.
// Kept out of BikeFields on purpose: GEAR_QUERY would otherwise compute every
// bike's summary on every garage load.
export const BIKE_COST_SUMMARY = gql`
  query BikeCostSummary($id: ID!) {
    bike(id: $id) {
      id
      costSummary {
        currency
        bikeMinor
        partsMinor
        serviceMinor
        totalMinor
        rideHours
        perHourMinor
        otherCurrencyCount
        byYear {
          year
          partsMinor
          serviceMinor
        }
      }
    }
  }
`;
