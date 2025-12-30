import { prisma } from '../../lib/prisma';
import type { RideMetrics } from './types';
import {
  RECENT_RIDES_TARGET,
  PRIMARY_WINDOW_DAYS,
  FALLBACK_WINDOW_DAYS,
} from './config';

/**
 * Subtract days from a date.
 */
function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Get recent rides for wear calculation with windowing logic.
 *
 * Windowing rules from spec:
 * - Prefer last 10 rides
 * - If fewer than 10 rides in last 30 days, extend to 90 days
 * - If still too few rides, use whatever is available
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 * @param afterDate - Optional: only include rides after this date (e.g., last service date)
 * @returns Array of ride metrics
 */
export async function getRecentRides(
  userId: string,
  bikeId: string,
  afterDate?: Date | null
): Promise<RideMetrics[]> {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, PRIMARY_WINDOW_DAYS);
  const ninetyDaysAgo = subDays(now, FALLBACK_WINDOW_DAYS);

  // Build date filter based on afterDate and window
  const buildDateFilter = (windowStart: Date) => {
    if (afterDate) {
      // Use the later of afterDate or windowStart
      const effectiveStart = afterDate > windowStart ? afterDate : windowStart;
      return { gt: effectiveStart };
    }
    return { gte: windowStart };
  };

  // Try primary window (30 days)
  let rides = await prisma.ride.findMany({
    where: {
      userId,
      bikeId,
      startTime: buildDateFilter(thirtyDaysAgo),
      isDuplicate: false,
    },
    orderBy: { startTime: 'desc' },
    take: RECENT_RIDES_TARGET,
    select: {
      durationSeconds: true,
      distanceMiles: true,
      elevationGainFeet: true,
      startTime: true,
    },
  });

  // If not enough rides in primary window, try fallback (90 days)
  if (rides.length < RECENT_RIDES_TARGET) {
    rides = await prisma.ride.findMany({
      where: {
        userId,
        bikeId,
        startTime: buildDateFilter(ninetyDaysAgo),
        isDuplicate: false,
      },
      orderBy: { startTime: 'desc' },
      take: RECENT_RIDES_TARGET,
      select: {
        durationSeconds: true,
        distanceMiles: true,
        elevationGainFeet: true,
        startTime: true,
      },
    });
  }

  // If still not enough, just get whatever is available since afterDate
  if (rides.length < RECENT_RIDES_TARGET && afterDate) {
    rides = await prisma.ride.findMany({
      where: {
        userId,
        bikeId,
        startTime: { gt: afterDate },
        isDuplicate: false,
      },
      orderBy: { startTime: 'desc' },
      take: RECENT_RIDES_TARGET,
      select: {
        durationSeconds: true,
        distanceMiles: true,
        elevationGainFeet: true,
        startTime: true,
      },
    });
  }

  return rides as RideMetrics[];
}

/**
 * Get all rides since a specific date for a bike.
 * Used to calculate total wear/hours since last service.
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 * @param sinceDate - Only include rides after this date
 * @returns Array of ride metrics
 */
export async function getRidesSinceDate(
  userId: string,
  bikeId: string,
  sinceDate: Date
): Promise<RideMetrics[]> {
  const rides = await prisma.ride.findMany({
    where: {
      userId,
      bikeId,
      startTime: { gt: sinceDate },
      isDuplicate: false,
    },
    orderBy: { startTime: 'asc' },
    select: {
      durationSeconds: true,
      distanceMiles: true,
      elevationGainFeet: true,
      startTime: true,
    },
  });

  return rides as RideMetrics[];
}

/**
 * Count rides since a specific date for a bike.
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 * @param sinceDate - Only count rides after this date
 * @returns Number of rides
 */
export async function countRidesSinceDate(
  userId: string,
  bikeId: string,
  sinceDate: Date
): Promise<number> {
  return prisma.ride.count({
    where: {
      userId,
      bikeId,
      startTime: { gt: sinceDate },
      isDuplicate: false,
    },
  });
}

/**
 * Get the first ride date for a bike.
 * Used as fallback when no service history exists.
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 * @returns First ride date or null if no rides
 */
export async function getFirstRideDate(
  userId: string,
  bikeId: string
): Promise<Date | null> {
  const ride = await prisma.ride.findFirst({
    where: {
      userId,
      bikeId,
      isDuplicate: false,
    },
    orderBy: { startTime: 'asc' },
    select: { startTime: true },
  });

  return ride?.startTime ?? null;
}

/**
 * Get the bike creation date.
 * Used as fallback when no service history and no rides exist.
 *
 * @param bikeId - Bike ID
 * @returns Bike creation date or current date if not found
 */
export async function getBikeCreatedAt(bikeId: string): Promise<Date> {
  const bike = await prisma.bike.findUnique({
    where: { id: bikeId },
    select: { createdAt: true },
  });

  return bike?.createdAt ?? new Date();
}
