import type { NormalizedStreams } from './ride-streams';

/**
 * Normalizer for tracks recorded by the Loam mobile app, alongside
 * ./garmin-streams and ./strava-streams.
 *
 * The difference is where the data comes from: a provider normalizer parses
 * someone else's payload, while this one validates our own client's. That
 * makes it the only normalizer whose input is genuinely untrusted, since it
 * arrives on a mutation any authenticated caller can send, so every array is
 * length-checked and every value range-checked before it becomes a stored blob
 * that lift detection and the ride-track map will read back as fact.
 *
 * Altitude here is the recorder's FUSED barometric series, not raw GPS
 * altitude (see the mobile app's lib/recording/altitude). Phone GNSS vertical
 * error is far too large to accumulate directly, so the fusion happens on the
 * device where the pressure sensor is; this stores the result.
 */

/** Ceiling on stored points. Mirrors MAX_TRACK_POINTS in the mobile recorder. */
export const MAX_RECORDED_TRACK_POINTS = 10000;

/** Below this a track cannot describe a route and is not worth storing. */
const MIN_RECORDED_TRACK_POINTS = 2;

/** Dead Sea shore to well above Everest, with room to spare either way. */
const MIN_ALTITUDE_M = -500;
const MAX_ALTITUDE_M = 9000;

export type RecordedTrackInput = {
  time: number[];
  latlng: number[][];
  altitude: number[];
  moving: boolean[];
};

export type RecordedTrackResult =
  | { status: 'ok'; pointCount: number; data: NormalizedStreams }
  | { status: 'invalid'; reason: string };

/**
 * Validate and normalize one recorded track.
 *
 * Never throws. A malformed track is a client bug worth hearing about, but the
 * ride it came with is the thing the rider actually cares about and the thing
 * their component hours depend on, so the caller logs the reason and saves the
 * ride without a track rather than rejecting the whole mutation. Rejecting
 * would be worse than it sounds: the mobile outbox treats a deterministic
 * failure as terminal, so a bad track would cost the rider the ride.
 */
export function normalizeRecordedTrack(input: RecordedTrackInput): RecordedTrackResult {
  const { time, latlng, altitude, moving } = input;

  if (!Array.isArray(time) || !Array.isArray(latlng) || !Array.isArray(altitude) || !Array.isArray(moving)) {
    return { status: 'invalid', reason: 'track arrays missing' };
  }

  const n = time.length;
  // RideSegment stores integer indexes into these arrays, so a ragged track
  // would leave lift detection reading one sample's altitude at another
  // sample's coordinate. Cheaper to refuse than to reason about later.
  if (latlng.length !== n || altitude.length !== n || moving.length !== n) {
    return {
      status: 'invalid',
      reason: `ragged track arrays: time=${n} latlng=${latlng.length} altitude=${altitude.length} moving=${moving.length}`,
    };
  }
  if (n < MIN_RECORDED_TRACK_POINTS) {
    return { status: 'invalid', reason: `track too short: ${n} points` };
  }

  const time_: number[] = [];
  const latlng_: [number, number][] = [];
  const altitude_: number[] = [];
  const moving_: boolean[] = [];

  let previousTime = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = time[i];
    const pair = latlng[i];
    const ele = altitude[i];

    if (!Number.isFinite(t) || t < 0) {
      return { status: 'invalid', reason: `bad time at index ${i}` };
    }
    // Consumers walk these arrays computing dt between neighbours; time going
    // backwards would produce negative durations and negative VAM.
    if (t < previousTime) {
      return { status: 'invalid', reason: `time decreases at index ${i}` };
    }
    previousTime = t;

    if (!Array.isArray(pair) || pair.length !== 2) {
      return { status: 'invalid', reason: `bad latlng at index ${i}` };
    }
    const [lat, lng] = pair;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { status: 'invalid', reason: `latlng out of range at index ${i}` };
    }
    if (!Number.isFinite(ele) || ele < MIN_ALTITUDE_M || ele > MAX_ALTITUDE_M) {
      return { status: 'invalid', reason: `altitude out of range at index ${i}` };
    }

    // Exactly (0, 0) is the "no fix yet" sentinel some location stacks emit,
    // not a place. The recorder drops it too; this is the backstop, and it
    // drops the single point rather than the track, since one slipped
    // sentinel should not cost a rider their whole route.
    if (lat === 0 && lng === 0) continue;

    time_.push(Math.round(t));
    latlng_.push([lat, lng]);
    altitude_.push(ele);
    moving_.push(moving[i] === true);
  }

  if (time_.length < MIN_RECORDED_TRACK_POINTS) {
    return { status: 'invalid', reason: `track too short after filtering: ${time_.length} points` };
  }

  // The client already strides down to the same ceiling, so this only fires
  // for an old or modified client. Thinning beats truncating: a truncated
  // track silently loses the back half of the ride and would have lift
  // detection analyzing a route that stops in the middle of the mountain.
  const keep = strideIndexes(time_.length, MAX_RECORDED_TRACK_POINTS);

  return {
    status: 'ok',
    pointCount: keep.length,
    data: {
      time: keep.map((i) => time_[i]),
      latlng: keep.map((i) => latlng_[i]),
      altitude: keep.map((i) => altitude_[i]),
      moving: keep.map((i) => moving_[i]),
    },
  };
}

/** Evenly spaced indexes into a length-`n` array, at most `max` of them. */
function strideIndexes(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = n / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(Math.floor(i * step));
  out[out.length - 1] = n - 1;
  return out;
}
