import { gql } from '@apollo/client';

// Count of the viewer's Garmin rides missing coordinates (and therefore
// weather). Drives whether the repair prompt is shown.
export const GARMIN_RIDES_MISSING_COORDS = gql`
  query GarminRidesMissingCoords {
    me {
      id
      garminRidesMissingCoords
    }
  }
`;

// Trigger a throttled, server-side re-import of those rides from Garmin.
// status: STARTED | ALREADY_RUNNING | NEEDS_RECONNECT | NOT_CONNECTED | NOTHING_TO_DO
export const BACKFILL_GARMIN_WEATHER = gql`
  mutation BackfillGarminWeather {
    backfillGarminWeather {
      status
      ridesToRepair
    }
  }
`;
