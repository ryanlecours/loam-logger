import { logger } from './logger';
import type { NormalizedStreams, RideStreamsResult } from './ride-streams';

// Full-resolution per-point streams for one activity. Cadence/heartrate/moving
// cost nothing extra to request and are needed by lift detection (cadence
// absence is a kinematic signal; `moving` lets deltas count only points Strava
// considered moving). `watts` is requested so Strava reaches parity with the
// Garmin normalizer, which gets power for free in the Activity Details samples.
const STREAM_KEYS = 'time,latlng,altitude,velocity_smooth,cadence,heartrate,watts,moving';
const FETCH_TIMEOUT_MS = 15_000;

type StravaStream = {
  data: unknown[];
  series_type?: string;
  original_size?: number;
  resolution?: string;
};

type StravaStreamsResponse = Record<string, StravaStream | undefined>;

// The normalized shape now lives in ./ride-streams so Garmin can share it.
// Re-exported here for the existing importers.
export type { NormalizedStreams };

export type StravaStreamsResult = RideStreamsResult;

/**
 * Fetch raw streams for a Strava activity. Throws on transient failures
 * (network, 5xx, 429, timeout) so the caller's queue can retry; returns
 * `no_streams` for activities that will never have per-point data.
 */
export async function fetchStravaStreams(
  accessToken: string,
  stravaActivityId: string
): Promise<StravaStreamsResult> {
  const url =
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/streams` +
    `?keys=${STREAM_KEYS}&key_by_type=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    return { status: 'no_streams' };
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava streams API error: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as StravaStreamsResponse;

  const time = payload.time?.data as number[] | undefined;
  const latlng = payload.latlng?.data as [number, number][] | undefined;

  // Streams without a time base or GPS track can't be lift-analyzed and are
  // not worth storing (indoor/trainer rides).
  if (!time?.length || !latlng?.length) {
    logger.debug({ stravaActivityId }, '[StravaStreams] No time/latlng stream, skipping');
    return { status: 'no_streams' };
  }

  const data: NormalizedStreams = { time, latlng };
  const altitude = payload.altitude?.data as number[] | undefined;
  const velocity = payload.velocity_smooth?.data as number[] | undefined;
  const cadence = payload.cadence?.data as number[] | undefined;
  const heartrate = payload.heartrate?.data as number[] | undefined;
  const power = payload.watts?.data as number[] | undefined;
  const moving = payload.moving?.data as boolean[] | undefined;
  if (altitude?.length) data.altitude = altitude;
  if (velocity?.length) data.velocity = velocity;
  if (cadence?.length) data.cadence = cadence;
  if (heartrate?.length) data.heartrate = heartrate;
  if (power?.length) data.power = power;
  if (moving?.length) data.moving = moving;

  return { status: 'ok', pointCount: time.length, data };
}
