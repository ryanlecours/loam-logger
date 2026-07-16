import { gql } from '@apollo/client';

export const UPDATE_BIKES_ORDER = gql`
  mutation UpdateBikesOrder($bikeIds: [ID!]!) {
    updateBikesOrder(bikeIds: $bikeIds) {
      id
      sortOrder
    }
  }
`;

// Light query without predictions - loads fast for initial render
export const BIKES_LIGHT = gql`
  query BikesLight {
    bikes {
      id
      nickname
      manufacturer
      model
      thumbnailUrl
      travelForkMm
      travelShockMm
      notes
      sortOrder
      fork {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      shock {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      pivotBearings {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      components {
        id
        type
        location
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
        pairGroupId
      }
    }
  }
`;

export const BIKES = gql`
  query Bikes {
    bikes {
      id
      nickname
      manufacturer
      model
      thumbnailUrl
      travelForkMm
      travelShockMm
      notes
      sortOrder
      fork {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      shock {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      pivotBearings {
        id
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
      }
      components {
        id
        type
        location
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
        pairGroupId
      }
      predictions {
        bikeId
        bikeName
        overallStatus
        dueNowCount
        dueSoonCount
        generatedAt
        priorityComponent {
          componentId
          componentType
          location
          brand
          model
          status
          hoursRemaining
          ridesRemainingEstimate
          confidence
          currentHours
          serviceIntervalHours
          hoursSinceService
          ridesSinceService
          why
          drivers {
            factor
            contribution
            label
          }
        }
        components {
          componentId
          componentType
          location
          brand
          model
          status
          hoursRemaining
          ridesRemainingEstimate
          confidence
          currentHours
          serviceIntervalHours
          hoursSinceService
          ridesSinceService
          why
          drivers {
            factor
            contribution
            label
          }
        }
        # Pro-only LLM maintenance summary. Requested ONLY here (the dashboard
        # query that feeds the priority hero + bike switcher, the only surfaces
        # that render it) — deliberately NOT in the shared PREDICTION_FIELDS
        # fragment, so the Gear-page list query doesn't trigger per-bike LLM
        # calls it never displays. API serves null for free/empty/ALL_GOOD/
        # rate-limited/error, and the widget renders nothing on null.
        advisorSummary {
          text
          generatedAt
          modelVersion
        }
      }
    }
  }
`;
