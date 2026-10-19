import { gql } from '@apollo/client';

const SHARE_FIELDS = `
  id
  scope
  rangeStart
  rangeEnd
  includeRides
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

/** Turn a sent link's ride list on or off; the URL stays the same. */
export const UPDATE_COMPONENT_SHARE = gql`
  mutation UpdateComponentShare($id: ID!, $includeRides: Boolean!) {
    updateComponentShare(id: $id, includeRides: $includeRides) {
      ${SHARE_FIELDS}
    }
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
      # The owner opted this link into a ride list (SHARED_COMPONENT_RIDES).
      includeRides
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

/**
 * Public: one page of an opted-in link's rides, newest first. Null for a link
 * without the opt-in. Rows carry no ids, so pages merge by offset.
 */
export const SHARED_COMPONENT_RIDES = gql`
  query SharedComponentRides($slug: String!, $take: Int, $offset: Int) {
    sharedComponentRides(slug: $slug, take: $take, offset: $offset) {
      hasMore
      rides {
        date
        durationSeconds
        distanceMeters
        elevationGainMeters
        trailSystem
        location
        sources
        garminAttribution
      }
    }
  }
`;
