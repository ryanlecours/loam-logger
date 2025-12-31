import { prisma } from '../../lib/prisma';
import type { RideMetrics } from './types';
import { RECENT_RIDES_TARGET } from './config';

/**
 * Get recent rides for wear calculation.
 *
 * Returns up to RECENT_RIDES_TARGET (10) most recent rides for the bike.
 * If afterDate is provided, only includes rides after that date.
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
  // Single query: get the most recent rides, respecting afterDate if provided
  // The windowing logic (30/90 days) was causing up to 3 sequential queries
  // with overlapping data. Instead, just fetch the target number of most recent
  // rides - this gives us the data we need in a single query.
  const rides = await prisma.ride.findMany({
    where: {
      userId,
      bikeId,
      isDuplicate: false,
      ...(afterDate && { startTime: { gt: afterDate } }),
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

/**
 * Get all rides for a bike, ordered by startTime ascending.
 * Used for batch prediction to avoid N+1 queries.
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 * @returns Array of ride metrics ordered by startTime
 */
export async function getAllRidesForBike(
  userId: string,
  bikeId: string
): Promise<RideMetrics[]> {
  const rides = await prisma.ride.findMany({
    where: {
      userId,
      bikeId,
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
