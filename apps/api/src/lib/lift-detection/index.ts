export {
  DETECTOR_VERSION,
  DEFAULT_OPTIONS,
  KINEMATIC_ONLY_OPTIONS,
  pointsFromStream,
  detectLiftSegments,
  computeAdjustedMetrics,
  haversineMeters,
  distanceToLiftLineMeters,
} from './detector';
export type {
  RidePoint,
  LiftLine,
  DetectedLiftSegment,
  DetectionOptions,
  AdjustedRideMetrics,
} from './detector';

export {
  getLiftLines,
  cellKeysForPoints,
  buildOverpassQuery,
  parseOverpassAerialways,
  probeOverpass,
  GeometryUnavailableError,
} from './overpass';
export type { LiftLinesResult, GeometryUnavailableReason, OverpassProbeResult } from './overpass';

// The snapshot fetch and load live beside these and are imported directly by
// scripts/lift-geometry.ts; the API itself only reads.
export { getActiveLiftGeometryImport } from './local-geometry';
export type { ActiveLiftGeometryImport } from './local-geometry';
