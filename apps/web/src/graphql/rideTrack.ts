import { gql } from '@apollo/client';

// Owner-only downsampled GPS track for one ride. Fetched lazily when a ride
// is opened (never in the rides list — the blob read stays per-ride).
export const RIDE_TRACK = gql`
  query RideTrack($rideId: ID!) {
    rideTrack(rideId: $rideId) {
      status
      points
      sampledFrom
      # Attribution for the rendered map — see the RideTrack type docs.
      source
      garminDeviceName
    }
  }
`;

// Enqueues a stream fetch for a pre-stream-era Strava ride, then the client
// polls RIDE_TRACK until AVAILABLE.
export const REQUEST_RIDE_TRACK = gql`
  mutation RequestRideTrack($rideId: ID!) {
    requestRideTrack(rideId: $rideId) {
      status
      points
      sampledFrom
      # Attribution for the rendered map — see the RideTrack type docs.
      source
      garminDeviceName
    }
  }
`;
