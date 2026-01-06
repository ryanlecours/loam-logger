import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendNotFound, sendForbidden, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';
import { isDuplicateActivity } from '../lib/duplicate-detector';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Get all duplicate rides for a user
 */
r.get('/duplicates', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Find all rides that have duplicates
    const ridesWithDuplicates = await prisma.ride.findMany({
      where: {
        userId,
        duplicates: {
          some: {},
        },
      },
      include: {
        duplicates: {
          select: {
            id: true,
            startTime: true,
            durationSeconds: true,
            distanceMiles: true,
            elevationGainFeet: true,
            garminActivityId: true,
            stravaActivityId: true,
            rideType: true,
            notes: true,
            createdAt: true,
          },
        },
      },
      orderBy: { startTime: 'desc' },
    });

    return res.json({
      success: true,
      duplicates: ridesWithDuplicates,
    });
  } catch (error) {
    logError('Duplicates fetching', error);
    return sendInternalError(res, 'Failed to fetch duplicates');
  }
});

/**
 * Merge duplicates - keep one, delete the other
 */
r.post<Empty, void, { keepRideId: string; deleteRideId: string }>(
  '/duplicates/merge',
  async (req: Request<Empty, void, { keepRideId: string; deleteRideId: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const { keepRideId, deleteRideId } = req.body;

    if (!keepRideId || !deleteRideId) {
      return sendBadRequest(res, 'Missing keepRideId or deleteRideId');
    }

    try {
      // Verify both rides belong to this user
      const [keepRide, deleteRide] = await Promise.all([
        prisma.ride.findUnique({ where: { id: keepRideId }, select: { userId: true } }),
        prisma.ride.findUnique({ where: { id: deleteRideId }, select: { userId: true } }),
      ]);

      if (!keepRide || !deleteRide) {
        return sendNotFound(res, 'One or both rides not found');
      }

      if (keepRide.userId !== userId || deleteRide.userId !== userId) {
        return sendForbidden(res, 'Unauthorized');
      }

      // Delete the duplicate
      await prisma.ride.delete({
        where: { id: deleteRideId },
      });

      // Clear duplicate flags on the kept ride
      await prisma.ride.update({
        where: { id: keepRideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null,
        },
      });

      console.log(`[Duplicates] Merged: kept ${keepRideId}, deleted ${deleteRideId}`);

      return res.json({
        success: true,
        message: 'Rides merged successfully',
        keptRideId: keepRideId,
      });
    } catch (error) {
      logError('Duplicates merging', error);
      return sendInternalError(res, 'Failed to merge rides');
    }
  }
);

/**
 * Mark rides as NOT duplicates (false positive)
 */
r.post<Empty, void, { rideId: string }>(
  '/duplicates/mark-not-duplicate',
  async (req: Request<Empty, void, { rideId: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const { rideId } = req.body;

    try {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { userId: true, duplicateOfId: true },
      });

      if (!ride) {
        return sendNotFound(res, 'Ride not found');
      }

      if (ride.userId !== userId) {
        return sendForbidden(res, 'Unauthorized');
      }

      // Clear duplicate flags
      await prisma.ride.update({
        where: { id: rideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null,
        },
      });

      return res.json({
        success: true,
        message: 'Ride marked as not duplicate',
      });
    } catch (error) {
      logError('Duplicates marking', error);
      return sendInternalError(res, 'Failed to update ride');
    }
  }
);

/**
 * Scan all user's rides and mark duplicate pairs
 */
r.post('/duplicates/scan', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Get all non-duplicate rides from both providers
    const allRides = await prisma.ride.findMany({
      where: {
        userId,
        isDuplicate: false,
        OR: [
          { garminActivityId: { not: null }, stravaActivityId: null },
          { stravaActivityId: { not: null }, garminActivityId: null },
        ],
      },
      select: {
        id: true,
        startTime: true,
        durationSeconds: true,
        distanceMiles: true,
        elevationGainFeet: true,
        garminActivityId: true,
        stravaActivityId: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // Separate by provider
    const garminRides = allRides.filter(r => r.garminActivityId);
    const stravaRides = allRides.filter(r => r.stravaActivityId);

    // Index Strava rides by 10-minute time buckets for O(1) lookup
    const BUCKET_MS = 10 * 60 * 1000;
    const stravaByBucket = new Map<number, typeof stravaRides>();
    for (const ride of stravaRides) {
      const bucket = Math.floor(ride.startTime.getTime() / BUCKET_MS);
      if (!stravaByBucket.has(bucket)) stravaByBucket.set(bucket, []);
      stravaByBucket.get(bucket)!.push(ride);
    }

    const duplicatePairs: Array<{ primaryId: string; duplicateId: string }> = [];
    const matchedStravaIds = new Set<string>();

    // Compare each Garmin ride only against Strava rides in same/adjacent time buckets
    for (const garminRide of garminRides) {
      const bucket = Math.floor(garminRide.startTime.getTime() / BUCKET_MS);
      const candidates = [
        ...(stravaByBucket.get(bucket - 1) ?? []),
        ...(stravaByBucket.get(bucket) ?? []),
        ...(stravaByBucket.get(bucket + 1) ?? []),
      ];

      for (const stravaRide of candidates) {
        // Skip if this Strava ride is already matched
        if (matchedStravaIds.has(stravaRide.id)) continue;

        if (isDuplicateActivity(garminRide, stravaRide)) {
          duplicatePairs.push({
            primaryId: garminRide.id,
            duplicateId: stravaRide.id,
          });
          matchedStravaIds.add(stravaRide.id);
          break; // Move to next Garmin ride
        }
      }
    }

    // Filter out invalid pairs (self-references and cycles) before updating
    const validPairs: typeof duplicatePairs = [];
    for (const pair of duplicatePairs) {
      // Prevent self-reference
      if (pair.duplicateId === pair.primaryId) {
        console.warn(`[Duplicates] Skipping self-reference: ${pair.duplicateId}`);
        continue;
      }
      validPairs.push(pair);
    }

    // Update database with duplicate relationships using transaction for atomicity
    if (validPairs.length > 0) {
      await prisma.$transaction(
        validPairs.map(pair =>
          prisma.ride.update({
            where: { id: pair.duplicateId },
            data: {
              isDuplicate: true,
              duplicateOfId: pair.primaryId,
            },
          })
        )
      );
    }

    console.log(`[Duplicates] Scan completed for user ${userId}: found ${duplicatePairs.length} duplicates`);

    return res.json({
      success: true,
      duplicatesFound: duplicatePairs.length,
      message: `Found and marked ${duplicatePairs.length} duplicate ride pairs`,
    });
  } catch (error) {
    logError('Duplicates scan', error);
    return sendInternalError(res, 'Failed to scan for duplicates');
  }
});

/**
 * Auto-merge all duplicates based on user's preferred data source
 */
r.post('/duplicates/auto-merge', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Get user's preferred data source
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });

    if (!user?.activeDataSource) {
      return sendBadRequest(res, 'No active data source set. Please set your preferred data source in Settings before auto-merging.');
    }

    const preferredSource = user.activeDataSource;

    // Find all rides marked as duplicates with their primary ride info
    const duplicateRides = await prisma.ride.findMany({
      where: {
        userId,
        isDuplicate: true,
        duplicateOfId: { not: null },
      },
      select: {
        id: true,
        durationSeconds: true,
        bikeId: true,
        garminActivityId: true,
        stravaActivityId: true,
        duplicateOfId: true,
      },
    });

    if (duplicateRides.length === 0) {
      return res.json({
        success: true,
        merged: 0,
        message: 'No duplicate rides to merge',
      });
    }

    // Batch fetch all primary rides to avoid N+1 queries
    const primaryRideIds = [...new Set(
      duplicateRides.map(r => r.duplicateOfId).filter((id): id is string => !!id)
    )];
    const primaryRides = await prisma.ride.findMany({
      where: { id: { in: primaryRideIds } },
      select: {
        id: true,
        durationSeconds: true,
        bikeId: true,
        garminActivityId: true,
        stravaActivityId: true,
      },
    });
    const primaryRideMap = new Map(primaryRides.map(r => [r.id, r]));

    const ridesToDelete: string[] = [];
    const hoursToDecrementByBike = new Map<string, number>();

    for (const dupRide of duplicateRides) {
      const primaryRide = primaryRideMap.get(dupRide.duplicateOfId!);
      if (!primaryRide) continue;

      // Determine which is from preferred source
      const dupIsFromPreferred = preferredSource === 'garmin'
        ? !!dupRide.garminActivityId
        : !!dupRide.stravaActivityId;
      const primaryIsFromPreferred = preferredSource === 'garmin'
        ? !!primaryRide.garminActivityId
        : !!primaryRide.stravaActivityId;

      let rideToDelete: typeof dupRide | typeof primaryRide;

      if (dupIsFromPreferred && !primaryIsFromPreferred) {
        // Keep duplicate, delete primary
        rideToDelete = primaryRide;
      } else {
        // Keep primary, delete duplicate
        rideToDelete = dupRide;
      }

      ridesToDelete.push(rideToDelete.id);

      // Track hours to decrement per bike
      if (rideToDelete.bikeId && rideToDelete.durationSeconds) {
        const hours = rideToDelete.durationSeconds / 3600;
        hoursToDecrementByBike.set(
          rideToDelete.bikeId,
          (hoursToDecrementByBike.get(rideToDelete.bikeId) ?? 0) + hours
        );
      }
    }

    // Perform deletions in transaction
    await prisma.$transaction(async (tx) => {
      // Adjust component hours
      for (const [bikeId, hours] of hoursToDecrementByBike.entries()) {
        await tx.component.updateMany({
          where: { userId, bikeId },
          data: { hoursUsed: { decrement: hours } },
        });
        // Floor at 0
        await tx.component.updateMany({
          where: { userId, bikeId, hoursUsed: { lt: 0 } },
          data: { hoursUsed: 0 },
        });
      }

      // Delete duplicate rides
      await tx.ride.deleteMany({
        where: { id: { in: ridesToDelete } },
      });

      // Clear duplicate flags on remaining rides
      await tx.ride.updateMany({
        where: { userId, isDuplicate: true },
        data: { isDuplicate: false, duplicateOfId: null },
      });
    });

    console.log(`[Duplicates] Auto-merge completed for user ${userId}: merged ${ridesToDelete.length} pairs, preferred: ${preferredSource}`);

    return res.json({
      success: true,
      merged: ridesToDelete.length,
      preferredSource,
      message: `Merged ${ridesToDelete.length} duplicate rides, keeping ${preferredSource === 'garmin' ? 'Garmin' : 'Strava'} data`,
    });
  } catch (error) {
    logError('Duplicates auto-merge', error);
    return sendInternalError(res, 'Failed to auto-merge duplicates');
  }
});

export default r;
