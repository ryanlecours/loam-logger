/**
 * Provider-neutral shape for per-point ride streams.
 *
 * This is the persisted shape of `RideStream.data`. Every provider normalizes
 * into it, and every consumer (lift detection, the ride-track map) reads only
 * this — so adding a provider means writing one normalizer, not touching the
 * consumers.
 *
 * The arrays are PARALLEL AND INDEX-ALIGNED: `time[i]`, `latlng[i]`,
 * `altitude[i]` all describe the same instant. `RideSegment` stores integer
 * indexes into them, so normalizers must never emit ragged arrays — drop a
 * sample from every array or from none.
 */
export type NormalizedStreams = {
  /** Seconds since the start of the activity. Monotonically non-decreasing. */
  time: number[];
  latlng: [number, number][];
  altitude?: number[];
  /** Metres per second. */
  velocity?: number[];
  /** Crank RPM. */
  cadence?: number[];
  heartrate?: number[];
  /** Watts. */
  power?: number[];
  /**
   * Whether the rider was moving at this sample. Strava reports it directly;
   * Garmin has no equivalent flag, so its normalizer derives it from speed.
   * Optional because consumers must tolerate its absence either way.
   */
  moving?: boolean[];
};

/**
 * Value stored in `RideStream.source`.
 *
 * `loam` is an in-app recording: the track came from the rider's own phone
 * rather than a provider grant, which is why the provider-disconnect cleanup
 * in ride-stream-store never touches it. Its altitude series is the fused
 * barometric one the mobile recorder computed, not a raw GPS altitude.
 */
export type RideStreamSource = 'strava' | 'garmin' | 'loam';

/**
 * Result of normalizing one activity's streams.
 *
 * `no_streams` is terminal for that activity — an indoor ride, a manual entry,
 * or an upload with no GPS will never gain a usable track, so callers should
 * not retry.
 */
export type RideStreamsResult =
  | { status: 'ok'; pointCount: number; data: NormalizedStreams }
  | { status: 'no_streams' };
