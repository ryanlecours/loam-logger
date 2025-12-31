import type { Component, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type {
  ComponentPrediction,
  BikePredictionSummary,
  PredictionStatus,
  ConfidenceLevel,
  PredictionEngineOptions,
  RideMetrics,
} from './types';
import {
  ALGO_VERSION,
  DUE_NOW_THRESHOLD_HOURS,
  DUE_SOON_THRESHOLD_HOURS,
  CONFIDENCE_HIGH_MIN_RIDES,
  CONFIDENCE_HIGH_MIN_HOURS,
  CONFIDENCE_MEDIUM_MIN_RIDES,
  CONFIDENCE_MEDIUM_MIN_HOURS,
  WEAR_RATIO_MIN,
  WEAR_RATIO_MAX,
  MAX_EXTENSION_RATIO,
  BASELINE_WEAR_PER_HOUR,
  getBaseInterval,
  getComponentWeights,
  isTrackableComponent,
} from './config';
import {
  calculateTotalWear,
  calculateTotalHours,
  calculateWearPerHourRatio,
  clamp,
} from './wear';
import { generateExplanation } from './explain';
import {
  getCachedPrediction,
  setCachedPrediction,
} from './cache';
import {
  getRecentRides,
  getRidesSinceDate,
  getFirstRideDate,
  getBikeCreatedAt,
} from './window';

/**
 * Determine prediction status from hours remaining.
 */
function getStatus(hoursRemaining: number): PredictionStatus {
  if (hoursRemaining <= 0) return 'OVERDUE';
  if (hoursRemaining <= DUE_NOW_THRESHOLD_HOURS) return 'DUE_NOW';
  if (hoursRemaining <= DUE_SOON_THRESHOLD_HOURS) return 'DUE_SOON';
  return 'ALL_GOOD';
}

/**
 * Determine confidence level based on ride count and hours.
 */
function getConfidence(rideCount: number, totalHours: number): ConfidenceLevel {
  if (rideCount >= CONFIDENCE_HIGH_MIN_RIDES && totalHours >= CONFIDENCE_HIGH_MIN_HOURS) {
    return 'HIGH';
  }
  if (rideCount >= CONFIDENCE_MEDIUM_MIN_RIDES || totalHours >= CONFIDENCE_MEDIUM_MIN_HOURS) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Estimate rides remaining based on recent average ride duration.
 */
function estimateRidesRemaining(
  hoursRemaining: number,
  recentRides: RideMetrics[]
): number {
  if (recentRides.length === 0 || hoursRemaining <= 0) {
    return 0;
  }

  const avgHoursPerRide =
    recentRides.reduce((sum, r) => sum + r.durationSeconds / 3600, 0) /
    recentRides.length;

  if (avgHoursPerRide <= 0) return 0;

  return Math.max(0, Math.round(hoursRemaining / avgHoursPerRide));
}

/**
 * Get the last service date for a component.
 * Falls back to first ride date or bike creation date.
 */
async function getLastServiceDate(
  componentId: string,
  userId: string,
  bikeId: string
): Promise<Date> {
  // Try to get last service log
  const lastService = await prisma.serviceLog.findFirst({
    where: { componentId },
    orderBy: { performedAt: 'desc' },
    select: { performedAt: true },
  });

  if (lastService) {
    return lastService.performedAt;
  }

  // Fallback: first ride date for this bike
  const firstRideDate = await getFirstRideDate(userId, bikeId);
  if (firstRideDate) {
    return firstRideDate;
  }

  // Fallback: bike creation date
  return getBikeCreatedAt(bikeId);
}

/**
 * Generate prediction for a single component.
 *
 * FREE tier: Deterministic (hoursRemaining = baseInterval - hoursSinceService)
 * PRO tier: Adaptive with wear ratio adjustment
 */
async function predictComponent(
  component: Component,
  userId: string,
  bikeId: string,
  recentRides: RideMetrics[],
  isPro: boolean
): Promise<ComponentPrediction> {
  // Get base interval for this component type and location
  const baseInterval =
    component.serviceDueAtHours ??
    getBaseInterval(component.type, component.location);

  // Get last service date
  const lastServiceDate = await getLastServiceDate(component.id, userId, bikeId);

  // Get rides and hours since last service
  const ridesSinceService = await getRidesSinceDate(userId, bikeId, lastServiceDate);
  const hoursSinceService = calculateTotalHours(ridesSinceService);
  const rideCountSinceService = ridesSinceService.length;

  let hoursRemaining: number;

  if (isPro && recentRides.length > 0) {
    // PRO tier: Adaptive prediction with wear ratio
    const weights = getComponentWeights(component.type);

    // Calculate wear since last service
    const wearSinceService = calculateTotalWear(ridesSinceService, weights);

    // Calculate recent wear per hour ratio
    const recentWearPerHour = calculateWearPerHourRatio(recentRides, component.type);

    // Clamp ratio to valid range
    const clampedRatio = clamp(
      recentWearPerHour / BASELINE_WEAR_PER_HOUR,
      WEAR_RATIO_MIN,
      WEAR_RATIO_MAX
    );

    // Adjust interval based on riding intensity
    // Higher ratio = harder riding = shorter effective interval
    const effectiveInterval = Math.min(
      baseInterval * MAX_EXTENSION_RATIO, // Hard cap on extension
      baseInterval / clampedRatio
    );

    // Calculate wear remaining
    const wearRemaining = effectiveInterval - wearSinceService;

    // Convert wear remaining to hours
    hoursRemaining = wearRemaining / Math.max(recentWearPerHour, 0.001);
    hoursRemaining = Math.max(0, hoursRemaining);
  } else {
    // FREE tier: Deterministic prediction
    hoursRemaining = Math.max(0, baseInterval - hoursSinceService);
  }

  // Determine status and confidence
  const status = getStatus(hoursRemaining);
  const totalHours = calculateTotalHours(recentRides);
  const confidence = getConfidence(rideCountSinceService, totalHours);
  const ridesRemainingEstimate = estimateRidesRemaining(hoursRemaining, recentRides);

  // Generate explanation for Pro tier
  let why: string | null = null;
  let drivers = null;

  if (isPro && recentRides.length > 0) {
    const explanation = generateExplanation(
      component.type,
      recentRides,
      hoursRemaining,
      status
    );
    why = explanation.why;
    drivers = explanation.drivers;
  }

  return {
    componentId: component.id,
    componentType: component.type,
    location: component.location,
    brand: component.brand,
    model: component.model,
    status,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10, // 1 decimal
    ridesRemainingEstimate,
    confidence,
    currentHours: Math.round(component.hoursUsed * 10) / 10,
    serviceIntervalHours: baseInterval,
    hoursSinceService: Math.round(hoursSinceService * 10) / 10,
    why,
    drivers,
  };
}

/**
 * Determine overall bike status from component predictions.
 * Returns the most urgent status.
 */
function getOverallStatus(predictions: ComponentPrediction[]): PredictionStatus {
  const statusPriority: PredictionStatus[] = [
    'OVERDUE',
    'DUE_NOW',
    'DUE_SOON',
    'ALL_GOOD',
  ];

  for (const status of statusPriority) {
    if (predictions.some((p) => p.status === status)) {
      return status;
    }
  }

  return 'ALL_GOOD';
}

/**
 * Find the highest priority component (most urgent).
 */
function findPriorityComponent(
  predictions: ComponentPrediction[]
): ComponentPrediction | null {
  if (predictions.length === 0) return null;

  return predictions.reduce((priority, current) => {
    const statusOrder: PredictionStatus[] = [
      'OVERDUE',
      'DUE_NOW',
      'DUE_SOON',
      'ALL_GOOD',
    ];
    const priorityIndex = statusOrder.indexOf(priority.status);
    const currentIndex = statusOrder.indexOf(current.status);

    // More urgent status wins
    if (currentIndex < priorityIndex) return current;

    // Same status: lower hours remaining wins
    if (currentIndex === priorityIndex && current.hoursRemaining < priority.hoursRemaining) {
      return current;
    }

    return priority;
  });
}

/**
 * Count components by status.
 */
function countByStatus(
  predictions: ComponentPrediction[],
  status: PredictionStatus
): number {
  return predictions.filter((p) => p.status === status).length;
}

/**
 * Main prediction engine entry point.
 * Generates predictions for all trackable components of a bike.
 *
 * @param options - Engine options
 * @returns Bike prediction summary
 */
export async function generateBikePredictions(
  options: PredictionEngineOptions
): Promise<BikePredictionSummary> {
  const { userId, bikeId, userRole, forceRefresh } = options;
  const isPro = userRole === 'PRO' || userRole === 'ADMIN';
  const planTier = isPro ? 'PRO' : 'FREE';

  // Check cache unless force refresh
  if (!forceRefresh) {
    const cached = await getCachedPrediction({
      userId,
      bikeId,
      algoVersion: ALGO_VERSION,
      planTier,
    });

    if (cached) {
      return cached;
    }
  }

  // Fetch bike with components
  const bike = await prisma.bike.findUnique({
    where: { id: bikeId },
    include: { components: true },
  });

  if (!bike || bike.userId !== userId) {
    throw new Error('Bike not found');
  }

  // Filter to trackable components only
  const trackableComponents = bike.components.filter((c) =>
    isTrackableComponent(c.type)
  );

  // Get recent rides for wear analysis
  const recentRides = await getRecentRides(userId, bikeId);

  // Generate predictions for each component (in parallel)
  const predictions = await Promise.all(
    trackableComponents.map((component) =>
      predictComponent(component, userId, bikeId, recentRides, isPro)
    )
  );

  // Build summary
  const bikeName = bike.nickname ?? `${bike.manufacturer} ${bike.model}`;
  const summary: BikePredictionSummary = {
    bikeId,
    bikeName,
    components: predictions,
    priorityComponent: findPriorityComponent(predictions),
    overallStatus: getOverallStatus(predictions),
    dueNowCount: countByStatus(predictions, 'DUE_NOW'),
    dueSoonCount: countByStatus(predictions, 'DUE_SOON'),
    generatedAt: new Date(),
    algoVersion: ALGO_VERSION,
  };

  // Cache the result
  await setCachedPrediction(
    {
      userId,
      bikeId,
      algoVersion: ALGO_VERSION,
      planTier,
    },
    summary
  );

  return summary;
}

/**
 * Generate predictions for all bikes belonging to a user.
 * Returns bikes sorted by urgency (most urgent first).
 *
 * @param userId - User ID
 * @param userRole - User role
 * @returns Array of bike prediction summaries sorted by urgency
 */
export async function generateAllBikePredictions(
  userId: string,
  userRole: UserRole
): Promise<BikePredictionSummary[]> {
  // Get all bikes for user
  const bikes = await prisma.bike.findMany({
    where: { userId },
    select: { id: true },
  });

  // Generate predictions for each bike
  const predictions: BikePredictionSummary[] = [];

  for (const bike of bikes) {
    try {
      const summary = await generateBikePredictions({
        userId,
        bikeId: bike.id,
        userRole,
      });
      predictions.push(summary);
    } catch (error) {
      console.error(`[PredictionEngine] Failed for bike ${bike.id}:`, error);
    }
  }

  // Sort by urgency (most urgent first)
  const statusPriority: Record<PredictionStatus, number> = {
    OVERDUE: 0,
    DUE_NOW: 1,
    DUE_SOON: 2,
    ALL_GOOD: 3,
  };

  predictions.sort((a, b) => {
    const aStatus = statusPriority[a.overallStatus];
    const bStatus = statusPriority[b.overallStatus];

    if (aStatus !== bStatus) return aStatus - bStatus;

    // Same status: compare by priority component hours remaining
    const aHours = a.priorityComponent?.hoursRemaining ?? Infinity;
    const bHours = b.priorityComponent?.hoursRemaining ?? Infinity;
    return aHours - bHours;
  });

  return predictions;
}

/**
 * Get the priority bike for a user (most urgent maintenance).
 *
 * @param userId - User ID
 * @param userRole - User role
 * @returns Priority bike summary or null if no bikes
 */
export async function getPriorityBike(
  userId: string,
  userRole: UserRole
): Promise<BikePredictionSummary | null> {
  const predictions = await generateAllBikePredictions(userId, userRole);
  return predictions[0] ?? null;
}
