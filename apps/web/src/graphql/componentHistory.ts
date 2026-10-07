import { gql } from '@apollo/client';

// A component's whole life: every bike it has been mounted on, lifetime
// distance/elevation/hours, its services, and the conditions it has ridden in.
//
// Aggregate-only by design — the server returns no ride rows, so this stays
// constant-size for any history length. COMPONENT_RIDES is the paged
// row-level companion.
//
// `lifetime` and `sinceService` are two windows over the same tenure-bounded
// rides: every ride, and the rides since the latest service. sinceService's
// hours are the stored counter the dashboard shows. See
// apps/api/src/lib/component-history.ts.
export const COMPONENT_HISTORY = gql`
  query ComponentHistory($componentId: ID!) {
    componentHistory(componentId: $componentId) {
      anchor
      coverage
      historyIncomplete
      driftDetected
      component {
        id
        type
        location
        brand
        model
        notes
        isStock
        bikeId
        status
        hoursUsed
        serviceDueAtHours
        # priorHours is declared, not derived: hours the part carried before
        # Loam Logger saw it. lifetimeHours already includes it; the lifetime
        # totals below are ride-derived only, so the two differ by priorHours.
        priorHours
        lifetimeHours
        hoursSinceService
        lastInspectedAt
        installedAt
        lastServicedAt
        retiredAt
        replacedById
      }
      lifetime {
        rideCount
        durationSeconds
        distanceMeters
        elevationGainMeters
        firstRideAt
        lastRideAt
      }
      sinceService {
        rideCount
        durationSeconds
        distanceMeters
        elevationGainMeters
        firstRideAt
        lastRideAt
      }
      tenures {
        id
        slotKey
        installedAt
        removedAt
        synthetic
        bike {
          id
          nickname
          manufacturer
          model
          year
          thumbnailUrl
        }
        totals {
          rideCount
          durationSeconds
          distanceMeters
          elevationGainMeters
        }
      }
      serviceEvents {
        id
        performedAt
        notes
        # SERVICE = work performed; INSPECTION = checked at a due service and
        # found good, so it stood in for the service.
        kind
        hoursAtService
        # INSPECTION only: hours of riding it granted before the next service.
        serviceExtensionHours
      }
      conditions {
        condition
        rideCount
        durationSeconds
      }
      cumulative {
        date
        cumulativeHours
        cumulativeDistanceMeters
        cumulativeElevationGainMeters
      }
    }
  }
`;
