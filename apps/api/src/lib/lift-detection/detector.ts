/**
 * Chairlift / gondola segment detection over a persisted ride stream.
 * Adapted from the reference liftDetection.ts (docs/plans/lift-detection-plan.md).
 *
 * Layered approach:
 *   Layer A - geometry match against OpenStreetMap aerialway ways (high
 *             precision, patchy coverage).
 *   Layer B - kinematic classifier (full coverage, occasionally confuses
 *             truck shuttles).
 *
 * Pure functions only — no I/O, no clock, no randomness — so everything here
 * is testable against fixtures without network access. Nothing mutates the
 * raw stream: the output is a list of typed segments that downstream metric
 * and wear calculations subtract from.
 */

import type { NormalizedStreams } from '../strava-streams';

/**
 * Bump when scoring/thresholds change in a way that should invalidate prior
 * results. Rides analyzed at an older version are re-detected from their
 * persisted stream on the next job run — no provider re-fetch.
 */
export const DETECTOR_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RidePoint {
  /** Seconds elapsed from activity start. */
  t: number;
  lat: number;
  lng: number;
  /** Meters. */
  ele: number;
  /** Meters per second. Derived from geometry when absent. */
  speed?: number;
  /** RPM. Undefined when the activity has no cadence stream. */
  cadence?: number;
}

/** A single OSM aerialway way, simplified to an ordered coordinate list. */
export interface LiftLine {
  id: string;
  name?: string;
  /** aerialway value: chair_lift, gondola, t-bar, platter, magic_carpet, etc. */
  kind: string;
  coordinates: Array<{ lat: number; lng: number }>;
}

export interface DetectedLiftSegment {
  startIndex: number;
  /** Inclusive. */
  endIndex: number;
  /** Seconds from activity start. */
  startTimeOffsetSec: number;
  endTimeOffsetSec: number;
  durationSec: number;
  distanceMeters: number;
  elevationGainMeters: number;
  /** Combined Layer A + Layer B score, 0..1. */
  confidence: number;
  /** Layer B alone, 0..1. */
  kinematicScore: number;
  /** Fraction of segment points within the lift-line buffer, 0..1. */
  geometryScore: number;
  matchedLiftName?: string;
  matchedLiftId?: string;
}

export interface DetectionOptions {
  /** Length of the scanning window in seconds. */
  windowSec: number;
  /** Stride between window starts in seconds. */
  strideSec: number;
  /** Minimum duration for a segment to survive into the output. */
  minSegmentSec: number;
  /** Minimum vertical gain for a segment to survive into the output. */
  minSegmentGainMeters: number;
  /** Confidence required to open a segment. */
  openThreshold: number;
  /** Confidence required to keep extending an open segment (hysteresis). */
  extendThreshold: number;
  /** Buffer distance around an OSM lift line, in meters. */
  liftBufferMeters: number;
}

// Threshold values are estimates pending validation against real park rides
// (plan increments 3–4); bump DETECTOR_VERSION when they change.
export const DEFAULT_OPTIONS: DetectionOptions = {
  windowSec: 60,
  strideSec: 15,
  minSegmentSec: 90,
  minSegmentGainMeters: 60,
  openThreshold: 0.62,
  extendThreshold: 0.45,
  liftBufferMeters: 40,
};

/**
 * Degraded mode for when Overpass is unavailable (plan §3.2): Layer B alone
 * must clear a higher bar, since it is the layer that confuses truck shuttles.
 */
export const KINEMATIC_ONLY_OPTIONS: DetectionOptions = {
  ...DEFAULT_OPTIONS,
  openThreshold: 0.72,
  extendThreshold: 0.55,
};

// ---------------------------------------------------------------------------
// Stream normalization
// ---------------------------------------------------------------------------

/**
 * Convert a persisted RideStream payload into detector points. Returns null
 * when the stream lacks an altitude series — elevation is the backbone of
 * every signal, so such rides cannot be analyzed (leave them unanalyzed
 * rather than recording a false "no lift found").
 */
export function pointsFromStream(streams: NormalizedStreams): RidePoint[] | null {
  const { time, latlng, altitude, velocity, cadence } = streams;
  if (!altitude?.length) return null;

  const n = Math.min(time.length, latlng.length, altitude.length);
  const points: RidePoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      t: time[i],
      lat: latlng[i][0],
      lng: latlng[i][1],
      ele: altitude[i],
      speed: velocity?.[i],
      cadence: cadence?.[i],
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Local equirectangular projection, accurate enough over the few kilometers a
 * single lift line spans and far cheaper than a full geodesic solution.
 */
function project(
  p: { lat: number; lng: number },
  originLat: number
): { x: number; y: number } {
  return {
    x: toRadians(p.lng) * Math.cos(toRadians(originLat)) * EARTH_RADIUS_M,
    y: toRadians(p.lat) * EARTH_RADIUS_M,
  };
}

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  u = Math.max(0, Math.min(1, u));

  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

export function distanceToLiftLineMeters(
  point: { lat: number; lng: number },
  line: LiftLine
): number {
  if (line.coordinates.length === 0) return Infinity;
  if (line.coordinates.length === 1) {
    return haversineMeters(point, line.coordinates[0]);
  }

  const originLat = point.lat;
  const p = project(point, originLat);
  let best = Infinity;

  for (let i = 0; i < line.coordinates.length - 1; i++) {
    const a = project(line.coordinates[i], originLat);
    const b = project(line.coordinates[i + 1], originLat);
    best = Math.min(best, distanceToSegment(p, a, b));
  }

  return best;
}

// ---------------------------------------------------------------------------
// Layer B: kinematic scoring
// ---------------------------------------------------------------------------

/** Maps a value onto 0..1 with a linear ramp between low and high. */
function ramp(value: number, low: number, high: number): number {
  if (high === low) return value >= high ? 1 : 0;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

interface WindowStats {
  durationSec: number;
  distanceMeters: number;
  elevationGainMeters: number;
  vamMetersPerHour: number;
  straightness: number;
  meanSpeed: number;
  speedCv: number;
  cadenceActiveFraction: number;
  hasCadenceStream: boolean;
  monotonicAscentFraction: number;
  onLiftFraction: number;
  matchedLiftName?: string;
  matchedLiftId?: string;
}

function computeWindowStats(
  points: RidePoint[],
  start: number,
  end: number,
  liftLines: LiftLine[],
  bufferMeters: number
): WindowStats {
  const first = points[start];
  const last = points[end];
  const durationSec = Math.max(1, last.t - first.t);

  let pathLength = 0;
  let ascendingSteps = 0;
  let steps = 0;
  const speeds: number[] = [];

  for (let i = start; i < end; i++) {
    const d = haversineMeters(points[i], points[i + 1]);
    const dt = Math.max(1, points[i + 1].t - points[i].t);

    pathLength += d;
    steps++;
    if (points[i + 1].ele >= points[i].ele) ascendingSteps++;

    const s = points[i].speed;
    speeds.push(typeof s === 'number' ? s : d / dt);
  }

  const netDistance = haversineMeters(first, last);
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  const variance =
    speeds.reduce((acc, s) => acc + (s - meanSpeed) ** 2, 0) /
    Math.max(1, speeds.length);
  const speedCv = meanSpeed > 0 ? Math.sqrt(variance) / meanSpeed : 1;

  const cadences = points
    .slice(start, end + 1)
    .map((p) => p.cadence)
    .filter((c): c is number => typeof c === 'number');
  const hasCadenceStream = cadences.length > 0;
  const cadenceActiveFraction = hasCadenceStream
    ? cadences.filter((c) => c > 5).length / cadences.length
    : 0;

  // Layer A overlay.
  let onLift = 0;
  let matchedLiftName: string | undefined;
  let matchedLiftId: string | undefined;
  if (liftLines.length > 0) {
    for (let i = start; i <= end; i++) {
      for (const line of liftLines) {
        if (distanceToLiftLineMeters(points[i], line) <= bufferMeters) {
          onLift++;
          if (matchedLiftId === undefined) {
            matchedLiftId = line.id;
            matchedLiftName = line.name ?? line.kind;
          }
          break;
        }
      }
    }
  }

  const elevationGainMeters = last.ele - first.ele;

  return {
    durationSec,
    distanceMeters: pathLength,
    elevationGainMeters,
    vamMetersPerHour: (elevationGainMeters / durationSec) * 3600,
    straightness: pathLength > 0 ? netDistance / pathLength : 0,
    meanSpeed,
    speedCv,
    cadenceActiveFraction,
    hasCadenceStream,
    monotonicAscentFraction: steps > 0 ? ascendingSteps / steps : 0,
    onLiftFraction: onLift / (end - start + 1) || 0,
    matchedLiftName,
    matchedLiftId,
  };
}

/**
 * Layer B alone: the kinematic signals, without any geometry contribution.
 *
 * Reasoning behind the thresholds:
 *  - VAM: a strong rider tops out near 1500 m/h on a road bike and well below
 *    that on a trail bike. Sustained ascent above 1200 m/h is mechanical.
 *  - Straightness: lifts run tower to tower in a straight line. Fire roads and
 *    shuttle roads switchback.
 *  - Speed CV: a lift holds constant line speed. A rider or a truck does not.
 *  - Cadence: zero cadence during sustained ascent is the single cleanest
 *    signal, but it only exists when the activity has a cadence stream.
 */
function scoreKinematic(stats: WindowStats): number {
  const signals: Array<{ weight: number; value: number }> = [
    { weight: 3, value: ramp(stats.vamMetersPerHour, 800, 1200) },
    { weight: 3, value: ramp(stats.straightness, 0.9, 0.975) },
    { weight: 2, value: 1 - ramp(stats.speedCv, 0.12, 0.35) },
    { weight: 2, value: ramp(stats.monotonicAscentFraction, 0.75, 0.95) },
    {
      weight: 2,
      // Lift line speed sits between roughly 1.5 and 6.5 m/s.
      value:
        stats.meanSpeed >= 1.5 && stats.meanSpeed <= 6.5
          ? 1
          : 1 - ramp(Math.abs(stats.meanSpeed - 4), 2.5, 6),
    },
  ];

  if (stats.hasCadenceStream) {
    signals.push({ weight: 4, value: 1 - ramp(stats.cadenceActiveFraction, 0.05, 0.25) });
  }

  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  return signals.reduce((a, s) => a + s.weight * s.value, 0) / totalWeight;
}

/** Combines Layer A and Layer B into a single 0..1 confidence. */
function combineScores(stats: WindowStats): { confidence: number; kinematicScore: number } {
  const kinematicScore = scoreKinematic(stats);

  // A confident geometry match short circuits most of the doubt.
  if (stats.onLiftFraction >= 0.8 && stats.elevationGainMeters > 0) {
    return {
      confidence: Math.min(1, 0.85 + 0.15 * stats.onLiftFraction),
      kinematicScore,
    };
  }

  if (stats.onLiftFraction > 0) {
    // Fold the partial geometry match in with the kinematic signals at the
    // same weight the reference gives it (3 of 12/16 total).
    const kinematicWeight = stats.hasCadenceStream ? 16 : 12;
    const geometryWeight = 3;
    return {
      confidence:
        (kinematicScore * kinematicWeight + stats.onLiftFraction * geometryWeight) /
        (kinematicWeight + geometryWeight),
      kinematicScore,
    };
  }

  return { confidence: kinematicScore, kinematicScore };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectLiftSegments(
  points: RidePoint[],
  liftLines: LiftLine[] = [],
  options: Partial<DetectionOptions> = {}
): DetectedLiftSegment[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (points.length < 10) return [];

  const indexAtOrAfter = (time: number, from: number): number => {
    let i = from;
    while (i < points.length && points[i].t < time) i++;
    return Math.min(i, points.length - 1);
  };

  interface Candidate {
    start: number;
    end: number;
    confidence: number;
  }

  const candidates: Candidate[] = [];
  const lastTime = points[points.length - 1].t;

  for (let tStart = points[0].t; tStart + opts.windowSec <= lastTime; tStart += opts.strideSec) {
    const start = indexAtOrAfter(tStart, 0);
    const end = indexAtOrAfter(tStart + opts.windowSec, start);
    if (end - start < 3) continue;

    const stats = computeWindowStats(points, start, end, liftLines, opts.liftBufferMeters);
    if (stats.elevationGainMeters <= 0) continue;

    const { confidence } = combineScores(stats);
    if (confidence >= opts.extendThreshold) {
      candidates.push({ start, end, confidence });
    }
  }

  // Merge overlapping candidates. A run is kept only if at least one of its
  // windows cleared the higher open threshold, which is the hysteresis that
  // stops segment boundaries from flapping.
  const merged: Candidate[] = [];
  for (const c of candidates) {
    const prev = merged[merged.length - 1];
    if (prev && c.start <= prev.end) {
      prev.end = Math.max(prev.end, c.end);
      prev.confidence = Math.max(prev.confidence, c.confidence);
    } else {
      merged.push({ ...c });
    }
  }

  return merged
    .filter((c) => c.confidence >= opts.openThreshold)
    .map((c) => {
      // Recompute over the merged span so scores and metric deltas describe
      // the whole persisted segment, not just its best window.
      const stats = computeWindowStats(points, c.start, c.end, liftLines, opts.liftBufferMeters);
      const { kinematicScore } = combineScores(stats);
      return {
        startIndex: c.start,
        endIndex: c.end,
        startTimeOffsetSec: points[c.start].t,
        endTimeOffsetSec: points[c.end].t,
        durationSec: stats.durationSec,
        distanceMeters: stats.distanceMeters,
        elevationGainMeters: stats.elevationGainMeters,
        confidence: c.confidence,
        kinematicScore,
        geometryScore: stats.onLiftFraction,
        matchedLiftName: stats.matchedLiftName,
        matchedLiftId: stats.matchedLiftId,
      };
    })
    .filter(
      (s) =>
        s.durationSec >= opts.minSegmentSec &&
        s.elevationGainMeters >= opts.minSegmentGainMeters
    );
}

// ---------------------------------------------------------------------------
// Adjusted metrics (consumed in the metric-exclusion increment; kept here so
// the exclusion semantics live next to the detector they depend on)
// ---------------------------------------------------------------------------

export interface AdjustedRideMetrics {
  /** Distance excluding lift segments. */
  distanceMeters: number;
  /** Elevation gain excluding lift segments. This is the number to display. */
  elevationGainMeters: number;
  /** Descent is unaffected by lifts but recomputed here for symmetry. */
  elevationLossMeters: number;
  /** Time excluding lift segments, for drivetrain wear accrual. */
  activeTimeSec: number;
  /** Time spent riding lifts, retained for auditing and lap counts. */
  liftTimeSec: number;
  liftGainMeters: number;
  liftCount: number;
}

export function computeAdjustedMetrics(
  points: RidePoint[],
  liftSegments: Array<Pick<DetectedLiftSegment, 'startIndex' | 'endIndex'>>
): AdjustedRideMetrics {
  const isLift = new Array<boolean>(points.length).fill(false);
  for (const seg of liftSegments) {
    for (let i = seg.startIndex; i <= seg.endIndex; i++) isLift[i] = true;
  }

  let distanceMeters = 0;
  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  let activeTimeSec = 0;
  let liftTimeSec = 0;
  let liftGainMeters = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dt = Math.max(0, points[i + 1].t - points[i].t);
    const dEle = points[i + 1].ele - points[i].ele;
    const d = haversineMeters(points[i], points[i + 1]);

    // A step counts as lift time only when both of its endpoints are inside a
    // lift segment, so boundary steps are attributed to riding.
    if (isLift[i] && isLift[i + 1]) {
      liftTimeSec += dt;
      if (dEle > 0) liftGainMeters += dEle;
      continue;
    }

    distanceMeters += d;
    activeTimeSec += dt;
    if (dEle > 0) elevationGainMeters += dEle;
    else elevationLossMeters += -dEle;
  }

  return {
    distanceMeters,
    elevationGainMeters,
    elevationLossMeters,
    activeTimeSec,
    liftTimeSec,
    liftGainMeters,
    liftCount: liftSegments.length,
  };
}
