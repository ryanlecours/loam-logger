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
        # Pro only (null for Free): what the bike has cost per ride hour.
        # Feeds the Spent chip's second line and the PDF's cost summary.
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
      rides {
        id
        startTime
        durationSeconds
        distanceMeters
        elevationGainMeters
        elevationLossMeters
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
        kind
        costMinor
        currency
        parts {
          id
          brand
          model
          priceMinor
          vendor
        }
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
        # Free for every tier: the plain sum of what the listed services cost.
        spendMinor
        spendCurrency
        spendOtherCurrencyCount
      }
      truncated
    }
  }
`;
