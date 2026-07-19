import {
  DEFAULT_OPTIONS,
  KINEMATIC_ONLY_OPTIONS,
  pointsFromStream,
  detectLiftSegments,
  computeAdjustedMetrics,
  type RidePoint,
  type LiftLine,
} from './detector';

// ---------------------------------------------------------------------------
// Synthetic fixtures. Point spacing is 5 s. A "lift" is a dead-straight,
// constant-speed (4 m/s), zero-cadence ascent at ~1400 m/h VAM — every Layer B
// signal saturated. Real-ride fixtures replace these in the validation phase.
// ---------------------------------------------------------------------------

const STEP_SEC = 5;
const LAT_PER_STEP = 0.00018; // ~20 m at 4 m/s over 5 s

type FixtureOpts = {
  startT?: number;
  startLat?: number;
  startEle?: number;
  count?: number;
};

function liftAscent(opts: FixtureOpts = {}): RidePoint[] {
  const { startT = 0, startLat = 45.0, startEle = 1000, count = 97 } = opts;
  const points: RidePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      t: startT + i * STEP_SEC,
      lat: startLat + i * LAT_PER_STEP,
      lng: -122.0,
      ele: startEle + i * 1.94, // ~1400 m/h VAM
      speed: 4,
      cadence: 0,
    });
  }
  return points;
}

// Pedaled switchback climb: modest VAM, active cadence, zigzag path,
// varying speed. Should never classify as a lift.
function pedaledClimb(opts: FixtureOpts = {}): RidePoint[] {
  const { startT = 0, startLat = 45.0, startEle = 1000, count = 97 } = opts;
  const points: RidePoint[] = [];
  let lng = -122.0;
  for (let i = 0; i < count; i++) {
    const zigDirection = Math.floor(i / 10) % 2 === 0 ? 1 : -1;
    lng += zigDirection * 0.0002;
    points.push({
      t: startT + i * STEP_SEC,
      lat: startLat + i * 0.00005,
      lng,
      ele: startEle + i * 0.7, // ~500 m/h VAM
      speed: 2 + (i % 5) * 0.4,
      cadence: 80,
    });
  }
  return points;
}

function liftLineAlong(points: RidePoint[], name = 'Summit Express'): LiftLine {
  return {
    id: 'way-1',
    name,
    kind: 'chair_lift',
    coordinates: [
      { lat: points[0].lat, lng: points[0].lng },
      { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng },
    ],
  };
}

describe('pointsFromStream', () => {
  it('maps parallel arrays to points', () => {
    const points = pointsFromStream({
      time: [0, 5],
      latlng: [[45, -122], [45.001, -122]],
      altitude: [1000, 1010],
      velocity: [4, 4.1],
      cadence: [0, 2],
    });

    expect(points).toEqual([
      { t: 0, lat: 45, lng: -122, ele: 1000, speed: 4, cadence: 0 },
      { t: 5, lat: 45.001, lng: -122, ele: 1010, speed: 4.1, cadence: 2 },
    ]);
  });

  it('returns null when the altitude series is missing', () => {
    expect(
      pointsFromStream({ time: [0, 5], latlng: [[45, -122], [45.001, -122]] })
    ).toBeNull();
  });
});

describe('detectLiftSegments', () => {
  it('detects a lift-like ascent kinematically (no geometry)', () => {
    const segments = detectLiftSegments(liftAscent(), [], DEFAULT_OPTIONS);

    expect(segments).toHaveLength(1);
    const seg = segments[0];
    expect(seg.kinematicScore).toBeGreaterThan(0.9);
    expect(seg.confidence).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.openThreshold);
    expect(seg.geometryScore).toBe(0);
    expect(seg.matchedLiftName).toBeUndefined();
    expect(seg.durationSec).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.minSegmentSec);
    expect(seg.elevationGainMeters).toBeGreaterThan(100);
  });

  it('short-circuits to high confidence on a geometry match and names the lift', () => {
    const points = liftAscent();
    const segments = detectLiftSegments(points, [liftLineAlong(points)], DEFAULT_OPTIONS);

    expect(segments).toHaveLength(1);
    const seg = segments[0];
    expect(seg.confidence).toBeGreaterThanOrEqual(0.85);
    expect(seg.geometryScore).toBeGreaterThan(0.9);
    expect(seg.matchedLiftName).toBe('Summit Express');
    expect(seg.matchedLiftId).toBe('way-1');
  });

  it('does not classify a pedaled switchback climb as a lift', () => {
    expect(detectLiftSegments(pedaledClimb(), [], DEFAULT_OPTIONS)).toHaveLength(0);
  });

  it('drops segments shorter than minSegmentSec', () => {
    // 75 s of lift-like ascent: windows can open but the merged segment is
    // under the 90 s survival floor.
    const short = liftAscent({ count: 16 });
    expect(detectLiftSegments(short, [], DEFAULT_OPTIONS)).toHaveLength(0);
  });

  it('separates two laps split by a descent into two segments', () => {
    const lap1 = liftAscent();
    const lastLift = lap1[lap1.length - 1];
    const descent: RidePoint[] = [];
    for (let i = 1; i <= 60; i++) {
      descent.push({
        t: lastLift.t + i * STEP_SEC,
        lat: lastLift.lat - i * 0.0003, // fast, not straight enough to matter: descending
        lng: -122.0 + (i % 2 === 0 ? 0.0004 : 0),
        ele: lastLift.ele - i * 3,
        speed: 8,
        cadence: 30,
      });
    }
    const lastDescent = descent[descent.length - 1];
    const lap2 = liftAscent({
      startT: lastDescent.t + STEP_SEC,
      startLat: lastDescent.lat,
      startEle: lastDescent.ele,
    });

    const segments = detectLiftSegments([...lap1, ...descent, ...lap2], [], DEFAULT_OPTIONS);
    expect(segments).toHaveLength(2);
  });

  it('kinematic-only options demand a higher bar than default', () => {
    expect(KINEMATIC_ONLY_OPTIONS.openThreshold).toBeGreaterThan(DEFAULT_OPTIONS.openThreshold);
    expect(KINEMATIC_ONLY_OPTIONS.extendThreshold).toBeGreaterThan(
      DEFAULT_OPTIONS.extendThreshold
    );
  });
});

describe('computeAdjustedMetrics', () => {
  it('attributes lift steps to lift time and the rest to active riding', () => {
    const lift = liftAscent(); // 96 steps × 5 s = 480 s, ~186 m gain
    const last = lift[lift.length - 1];
    const ride: RidePoint[] = [];
    for (let i = 1; i <= 60; i++) {
      ride.push({
        t: last.t + i * STEP_SEC,
        lat: last.lat + i * 0.0002,
        lng: -122.0,
        ele: last.ele - i * 2, // descending
        speed: 7,
        cadence: 20,
      });
    }
    const points = [...lift, ...ride];

    const metrics = computeAdjustedMetrics(points, [
      { startIndex: 0, endIndex: lift.length - 1 },
    ]);

    expect(metrics.liftCount).toBe(1);
    expect(metrics.liftTimeSec).toBe((lift.length - 1) * STEP_SEC);
    expect(metrics.liftGainMeters).toBeCloseTo(1.94 * (lift.length - 1), 0);
    // Active time = 59 steps within the 60 ride points + the boundary step.
    expect(metrics.activeTimeSec).toBe(60 * STEP_SEC);
    expect(metrics.elevationLossMeters).toBeCloseTo(120, 0);
    // No pedaled climbing outside the lift: gain excluding lift stays ~0.
    expect(metrics.elevationGainMeters).toBeLessThan(1);
  });
});
