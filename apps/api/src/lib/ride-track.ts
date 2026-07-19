import { prisma } from './prisma';
import type { NormalizedStreams } from './strava-streams';

// Keep payloads map-friendly: ~800 points is visually indistinguishable from
// the raw track at any zoom the web UI offers, and ~25 KB on the wire vs
// ~300 KB raw. Downsampled indices deliberately do NOT align with
// RideSegment stream indices — segment overlays slice the raw stream.
export const TRACK_TARGET_POINTS = 800;

export type RideTrackStatus = 'AVAILABLE' | 'FETCHABLE' | 'UNAVAILABLE';

export interface RideTrackResult {
  status: RideTrackStatus;
  points: [number, number][] | null;
  sampledFrom: number | null;
}

/** Stride-sample a polyline to ~target points, always keeping both endpoints. */
export function downsampleTrack(
  latlng: [number, number][],
  target: number = TRACK_TARGET_POINTS
): [number, number][] {
  if (latlng.length <= target) return latlng;
  const stride = (latlng.length - 1) / (target - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < target - 1; i++) {
    out.push(latlng[Math.round(i * stride)]);
  }
  out.push(latlng[latlng.length - 1]);
  return out;
}

/**
 * Owner-scoped track lookup. Throws "Ride not found" for missing rides and
 * for other users' rides alike (no existence oracle).
 */
export async function getRideTrack(userId: string, rideId: string): Promise<RideTrackResult> {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      userId: true,
      stravaActivityId: true,
      startLat: true,
      startLng: true,
      stream: { select: { pointCount: true, data: true } },
    },
  });

  if (!ride || ride.userId !== userId) {
    throw new Error('Ride not found');
  }

  if (ride.stream) {
    const latlng = (ride.stream.data as NormalizedStreams).latlng;
    if (latlng?.length) {
      return {
        status: 'AVAILABLE',
        points: downsampleTrack(latlng),
        sampledFrom: ride.stream.pointCount,
      };
    }
    // Persisted stream without latlng shouldn't exist (the fetch lib rejects
    // those), but degrade to UNAVAILABLE rather than 500.
    return { status: 'UNAVAILABLE', points: null, sampledFrom: null };
  }

  const fetchable =
    ride.stravaActivityId != null && ride.startLat != null && ride.startLng != null;
  return { status: fetchable ? 'FETCHABLE' : 'UNAVAILABLE', points: null, sampledFrom: null };
}
