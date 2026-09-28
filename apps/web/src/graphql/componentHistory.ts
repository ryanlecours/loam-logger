import { gql } from '@apollo/client';

// A component's whole life: every bike it has been mounted on, lifetime
// distance/elevation/hours, its services, and the conditions it has ridden in.
//
// Aggregate-only by design — the server returns no ride rows, so this stays
// constant-size for any history length. COMPONENT_RIDES is the paged
// row-level companion.
//
// Note `lifetime` and `sinceService` are different windows, not two views of
// one number: lifetime spans every install tenure with no service anchor,
// while sinceService is the canonical dashboard window. See
// apps/api/src/lib/component-history.ts for why they must differ.
export const COMPONENT_HISTORY = gql`
  query ComponentHistory($componentId: ID!) {
    componentHistory(componentId: $componentId) {
      anchor
      coverage
      historyIncomplete
      driftDetected
      consistencyWarning
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
        hoursSinceInspection
        inspectionDueAtHours
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
        # SERVICE = work performed; INSPECTION = checked, which resets only the
        # inspection clock.
        kind
        hoursAtService
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
