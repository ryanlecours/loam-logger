import { gql } from '@apollo/client';

export const BIKE_HISTORY = gql`
  query BikeHistory($bikeId: ID!, $startDate: String, $endDate: String) {
    bikeHistory(bikeId: $bikeId, startDate: $startDate, endDate: $endDate) {
      bike {
        id
        nickname
        manufacturer
        model
        year
        shareSlug
        # Drives the data-source attribution in the exported PDF footer —
        # an export is downstream data and must carry it on every page.
        contributingSources
      }
      rides {
        id
        startTime
        durationSeconds
        distanceMeters
        elevationGainMeters
        averageHr
        rideType
        trailSystem
        location
      }
      serviceEvents {
        id
        performedAt
        notes
        hoursAtService
        component {
          id
          type
          location
          brand
          model
        }
      }
      installs {
        id
        eventType
        occurredAt
        component {
          id
          type
          location
          brand
          model
        }
      }
      totals {
        rideCount
        totalDistanceMeters
        totalDurationSeconds
        totalElevationGainMeters
        serviceEventCount
        installEventCount
      }
      truncated
    }
  }
`;
