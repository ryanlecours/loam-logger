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
      }
    }
  }
`;

// Pro-only LLM maintenance summary, fetched as a SEPARATE third stage after
// BIKES so a slow/timed-out Anthropic call (up to the 8s client timeout) can
// never stall the core bike + prediction data on the dashboard's critical
// render path. The dashboard fires this once BIKES has resolved; the priority
// hero and switcher render immediately from BIKES and the advisor cards fill
// in when this arrives.
//
// This selects the same Bike.predictions field as BIKES but only advisorSummary.
// That's safe because BikePredictionSummary is normalized by bikeId (see the
// typePolicy in lib/apolloClient.ts): this partial write MERGES into the entity
// BIKES cached rather than clobbering its overallStatus/components. Dashboard
// merges the summary back into each bike client-side (see Dashboard.tsx), since
// the BIKES query result itself doesn't select advisorSummary.
export const BIKES_ADVISOR = gql`
  query BikesAdvisor {
    bikes {
      id
      predictions {
        bikeId
        advisorSummary {
          text
          generatedAt
          modelVersion
        }
      }
    }
  }
`;
