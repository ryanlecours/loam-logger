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
            distanceMeters: true,
            elevationGainMeters: true,
            garminActivityId: true,
            stravaActivityId: true,
            whoopWorkoutId: true,
            suuntoWorkoutId: true,
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
      // Verify both rides belong to this user and check duplicate relationship
      const [keepRide, deleteRide] = await Promise.all([
        prisma.ride.findUnique({ where: { id: keepRideId }, select: { userId: true, duplicateOfId: true } }),
        prisma.ride.findUnique({ where: { id: deleteRideId }, select: { userId: true, duplicateOfId: true } }),
      ]);

      if (!keepRide || !deleteRide) {
        return sendNotFound(res, 'One or both rides not found');
      }

      if (keepRide.userId !== userId || deleteRide.userId !== userId) {
        return sendForbidden(res, 'Unauthorized');
      }

      // Verify rides are actually marked as duplicates of each other
      const areDuplicates =
        deleteRide.duplicateOfId === keepRideId ||
        keepRide.duplicateOfId === deleteRideId;

      if (!areDuplicates) {
        return sendBadRequest(res, 'Rides are not marked as duplicates of each other');
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

      // Clear duplicate flags on this ride and any related rides in a transaction
      await prisma.$transaction(async (tx) => {
        // Clear flags on the provided ride
        await tx.ride.update({
          where: { id: rideId },
          data: {
            isDuplicate: false,
            duplicateOfId: null,
          },
        });

        // If this ride points to a primary, clear any other rides pointing to that same primary
        // (handles the case where we're marking the duplicate ride)
        if (ride.duplicateOfId) {
          await tx.ride.updateMany({
            where: {
              userId,
              duplicateOfId: ride.duplicateOfId,
            },
            data: {
              isDuplicate: false,
              duplicateOfId: null,
            },
          });
        }

        // Clear flags on any rides that point to this ride as their primary
        // (handles the case where we're marking the primary ride)
        await tx.ride.updateMany({
          where: {
            userId,
            duplicateOfId: rideId,
          },
          data: {
            isDuplicate: false,
            duplicateOfId: null,
          },
        });
      });

      return res.json({
        success: true,
        message: 'Rides marked as not duplicates',
      });
    } catch (error) {
      logError('Duplicates marking', error);
      return sendInternalError(res, 'Failed to update ride');
    }
  }
);

/**
 * Scan all user's rides and mark duplicate pairs across any pair of
 * providers (Garmin / Strava / WHOOP / Suunto). Earliest-seen ride in a
 * same-day match becomes the primary; subsequent provider duplicates on
 * the same day point at it.
 */
r.post('/duplicates/scan', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Pull all non-duplicate single-provider rides. `isDuplicateActivity`
    // enforces "exactly one provider per side", so mixed-provider rows are
    // filtered out here for symmetry.
    const allRides = await prisma.ride.findMany({
      where: {
        userId,
        isDuplicate: false,
        OR: [
          {
            garminActivityId: { not: null },
            stravaActivityId: null,
            whoopWorkoutId: null,
            suuntoWorkoutId: null,
          },
          {
            stravaActivityId: { not: null },
            garminActivityId: null,
            whoopWorkoutId: null,
            suuntoWorkoutId: null,
          },
          {
            whoopWorkoutId: { not: null },
            garminActivityId: null,
            stravaActivityId: null,
            suuntoWorkoutId: null,
          },
          {
            suuntoWorkoutId: { not: null },
            garminActivityId: null,
            stravaActivityId: null,
            whoopWorkoutId: null,
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
        suuntoWorkoutId: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // Index by UTC date for O(1) same-day lookup.
    const ridesByDate = new Map<string, typeof allRides>();
    for (const ride of allRides) {
      const dateKey = ride.startTime.toISOString().split('T')[0];
      if (!ridesByDate.has(dateKey)) ridesByDate.set(dateKey, []);
      ridesByDate.get(dateKey)!.push(ride);
    }

    const duplicatePairs: Array<{ primaryId: string; duplicateId: string }> = [];
    const matchedIds = new Set<string>();

    // Walk rides chronologically. The first occurrence of a real-world
    // ride (earliest startTime) becomes the primary; same-day rides from
    // a different provider that match within tolerance get linked to it.
    for (const primary of allRides) {
      if (matchedIds.has(primary.id)) continue;

      const dateKey = primary.startTime.toISOString().split('T')[0];
      const candidates = ridesByDate.get(dateKey) ?? [];

      for (const candidate of candidates) {
        if (candidate.id === primary.id) continue;
        if (matchedIds.has(candidate.id)) continue;

        if (isDuplicateActivity(primary, candidate)) {
          duplicatePairs.push({ primaryId: primary.id, duplicateId: candidate.id });
          matchedIds.add(candidate.id);
          // Don't break — a single primary can match duplicates from
          // multiple other providers on the same day (e.g., a Garmin
          // ride could be recorded on both Strava and Suunto).
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
      // Adjust component hours atomically (floor at 0 in single query)
      for (const [bikeId, hours] of hoursToDecrementByBike.entries()) {
        await tx.$executeRaw`
          UPDATE "Component"
          SET "hoursUsed" = GREATEST(0, "hoursUsed" - ${hours}),
              "updatedAt" = NOW()
          WHERE "userId" = ${userId} AND "bikeId" = ${bikeId}
        `;
      }

      // Clear duplicate flags on rides that will have their primary deleted
      // (must happen before deletion to avoid orphaned duplicateOfId references)
      if (ridesToDelete.length > 0) {
        await tx.ride.updateMany({
          where: {
            userId,
            duplicateOfId: { in: ridesToDelete },
          },
          data: { isDuplicate: false, duplicateOfId: null },
        });
      }

      // Delete duplicate rides
      await tx.ride.deleteMany({
        where: { id: { in: ridesToDelete } },
      });

      // Clear duplicate flags on any remaining rides marked as duplicates
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
