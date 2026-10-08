import { gql } from '@apollo/client';

const SHARE_FIELDS = `
  id
  scope
  rangeStart
  rangeEnd
  url
  createdAt
`;

/** The owner's share links for one component. */
export const COMPONENT_SHARES = gql`
  query ComponentShares($componentId: ID!) {
    component(id: $componentId) {
      id
      shares {
        ${SHARE_FIELDS}
      }
    }
  }
`;

export const CREATE_COMPONENT_SHARE = gql`
  mutation CreateComponentShare($input: CreateComponentShareInput!) {
    createComponentShare(input: $input) {
      ${SHARE_FIELDS}
    }
  }
`;

export const REVOKE_COMPONENT_SHARE = gql`
  mutation RevokeComponentShare($id: ID!) {
    revokeComponentShare(id: $id)
  }
`;

/** Public: one share link's window of a component's history. */
export const SHARED_COMPONENT_HISTORY = gql`
  query SharedComponentHistory($slug: String!) {
    sharedComponentHistory(slug: $slug) {
      component {
        type
        location
        brand
        model
        isStock
      }
      scope
      windowStart
      windowEnd
      totals {
        rideCount
        durationSeconds
        distanceMeters
        elevationGainMeters
        firstRideAt
        lastRideAt
      }
      declaredPriorHours
      bikes {
        bike {
          manufacturer
          model
          year
          thumbnailUrl
        }
        installedAt
        removedAt
        totals {
          rideCount
          durationSeconds
          distanceMeters
        }
      }
      logbook {
        performedAt
        kind
        hoursAtService
        serviceExtensionHours
      }
      cumulative {
        date
        cumulativeHours
      }
      # Drives the data-source attribution. This page is public, so
      # third-party attribution has to travel with the data.
      contributingSources
    }
  }
`;
