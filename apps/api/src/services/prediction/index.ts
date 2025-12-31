// =============================================================================
// Prediction Engine - Public API
// =============================================================================

// Types
export type {
  PredictionStatus,
  ConfidenceLevel,
  WearFactor,
  WearDriver,
  ComponentWearWeights,
  RideMetrics,
  ComponentPrediction,
  BikePredictionSummary,
  PredictionCacheKey,
  PredictionEngineOptions,
  ComponentWithService,
  WearCalculationResult,
} from './types';

// Engine - Main Entry Points
export {
  generateBikePredictions,
  generateAllBikePredictions,
  getPriorityBike,
} from './engine';

// Cache - Invalidation Functions
export {
  invalidateBikePrediction,
  invalidateUserPredictions,
} from './cache';

// Config - Constants and Helpers
export {
  ALGO_VERSION,
  DUE_NOW_THRESHOLD_HOURS,
  DUE_SOON_THRESHOLD_HOURS,
  getComponentWeights,
  getBaseInterval,
  isTrackableComponent,
  getTrackableComponentTypes,
} from './config';

// Wear - Calculation Functions (for testing/debugging)
export {
  calculateRideWear,
  calculateTotalWear,
  calculateTotalHours,
  calculateWearPerHourRatio,
} from './wear';
