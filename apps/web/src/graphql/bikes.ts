import { gql } from '@apollo/client';

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
        brand
        model
        hoursUsed
        serviceDueAtHours
        updatedAt
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
