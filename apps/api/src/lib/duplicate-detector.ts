import type { PrismaClient } from '@prisma/client';

export interface DuplicateCandidate {
  id: string;
  startTime: Date;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  garminActivityId: string | null;
  stravaActivityId: string | null;
  whoopWorkoutId: string | null;
}

/**
 * Determine if two rides are duplicates based on date, distance, and elevation thresholds
 */
export function isDuplicateActivity(
  newRide: DuplicateCandidate,
  existingRide: DuplicateCandidate
): boolean {
  // Count providers for each ride
  const newProviders = [
    newRide.garminActivityId,
    newRide.stravaActivityId,
    newRide.whoopWorkoutId,
  ].filter(Boolean);

  const existingProviders = [
    existingRide.garminActivityId,
    existingRide.stravaActivityId,
    existingRide.whoopWorkoutId,
  ].filter(Boolean);

  // Each ride should have exactly one provider
  if (newProviders.length !== 1 || existingProviders.length !== 1) return false;

  // Must be from different providers
  const newIsGarmin = !!newRide.garminActivityId;
  const newIsStrava = !!newRide.stravaActivityId;
  const newIsWhoop = !!newRide.whoopWorkoutId;
  const existingIsGarmin = !!existingRide.garminActivityId;
  const existingIsStrava = !!existingRide.stravaActivityId;
  const existingIsWhoop = !!existingRide.whoopWorkoutId;

  const differentProviders =
    (newIsGarmin && !existingIsGarmin) ||
    (newIsStrava && !existingIsStrava) ||
    (newIsWhoop && !existingIsWhoop);

  if (!differentProviders) return false;

  // Time threshold: same calendar day (UTC)
  const newDate = newRide.startTime.toISOString().split('T')[0];
  const existingDate = existingRide.startTime.toISOString().split('T')[0];
  if (newDate !== existingDate) return false;

  // Note: Duration check removed - providers report different durations for the same ride

  // Distance threshold: within 5% or 160m (~0.1 miles) (whichever is larger)
  const distanceDiff = Math.abs(newRide.distanceMeters - existingRide.distanceMeters);
  const distanceThreshold = Math.max(existingRide.distanceMeters * 0.05, 160);
  if (distanceDiff > distanceThreshold) return false;

  // Elevation threshold: within 5% or 30m (~100ft) (whichever is larger)
  // 30m minimum handles GPS noise on flat rides where devices may report wildly different values
  const elevationDiff = Math.abs(newRide.elevationGainMeters - existingRide.elevationGainMeters);
  const elevationThreshold = Math.max(existingRide.elevationGainMeters * 0.05, 30);
  if (elevationDiff > elevationThreshold) return false;

  // All criteria match - this is likely a duplicate
  return true;
}

/**
 * Find potential duplicates for a new ride
 * Returns the first matching duplicate, or null if none found
 */
export async function findPotentialDuplicates(
  userId: string,
  newRide: DuplicateCandidate,
  prisma: PrismaClient
): Promise<DuplicateCandidate | null> {
  // Search for rides on same calendar day (UTC)
  const rideDate = newRide.startTime.toISOString().split('T')[0];
  const startWindow = new Date(rideDate + 'T00:00:00.000Z');
  const endWindow = new Date(rideDate + 'T23:59:59.999Z');

  const potentialMatches = await prisma.ride.findMany({
    where: {
      userId,
      startTime: {
        gte: startWindow,
        lte: endWindow,
      },
      // Exclude rides that are already marked as duplicates
      isDuplicate: false,
      // Must be from a single provider (Garmin, Strava, or WHOOP only)
      OR: [
        {
          garminActivityId: { not: null },
          stravaActivityId: null,
          whoopWorkoutId: null,
        },
        {
          stravaActivityId: { not: null },
          garminActivityId: null,
          whoopWorkoutId: null,
        },
        {
          whoopWorkoutId: { not: null },
          garminActivityId: null,
          stravaActivityId: null,
        },
      ],
    },
    select: {
      id: true,
      startTime: true,
      durationSeconds: true,
      distanceMeters: true,
      elevationGainMeters: true,
      garminActivityId: true,
      stravaActivityId: true,
      whoopWorkoutId: true,
    },
  });

  // Check each potential match
  for (const candidate of potentialMatches) {
    if (isDuplicateActivity(newRide, candidate)) {
      return candidate;
    }
  }

  return null;
}
