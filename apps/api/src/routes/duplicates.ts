import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendNotFound, sendForbidden, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';
import { isDuplicateActivity } from '../lib/duplicate-detector';
import { findAdjustedComponentIdsForRides } from '../lib/component-hours';
import { recomputeCountersForBikes, BULK_RECOMPUTE_TX_OPTIONS } from '../lib/component-counters';
import { invalidateBikePrediction } from '../services/prediction/cache';

type Empty = Record<string, never>;
const r: Router = createRouter();

// Every route below changes which rides count toward a part: flagging a ride
// as a duplicate stops it counting, clearing the flag starts it again, and a
// merge deletes one side. Each one re-derives the counters of the rides' bikes
// from the ledger (recomputeCountersForBikes) instead of adjusting them by
// hand. Auto-merge used to subtract the deleted hours from hoursUsed alone,
// which left hoursSinceService, the figure predictions read, charging riders
// for rides that no longer existed.

type RideBike = { bikeId: string | null };

/** The distinct bikes of a set of rides, unassigned rides dropped. */
function rideBikeIds(rides: RideBike[]): string[] {
  return [...new Set(rides.map((r) => r.bikeId).filter((id): id is string => !!id))];
}

/**
 * The legacy hoursUsed debit per bike for deleting these rides, applied only
 * to parts whose counters have never been computed.
 *
 * Every deleted ride is debited, flagged or not. The legacy counter credited
 * each ride on arrival and nothing ever moved it for a duplicate flag, so both
 * sides of a pair are in it: deleting either one takes its hours out, and
 * clearing the kept ride's flag changes nothing.
 */
function legacyDebitByBike(
  rides: Array<RideBike & { durationSeconds: number | null }>
): Map<string, number> {
  const debit = new Map<string, number>();
  for (const ride of rides) {
    if (!ride.bikeId || !ride.durationSeconds) continue;
    debit.set(ride.bikeId, (debit.get(ride.bikeId) ?? 0) - ride.durationSeconds / 3600);
  }
  return debit;
}

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
        prisma.ride.findUnique({
          where: { id: keepRideId },
          select: { userId: true, duplicateOfId: true, bikeId: true },
        }),
        prisma.ride.findUnique({
          where: { id: deleteRideId },
          select: { userId: true, duplicateOfId: true, bikeId: true, durationSeconds: true },
        }),
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

      // Delete one ride and unflag the other, then recompute the counters of
      // both rides' bikes from the ledger. A per-ride debit cannot be right
      // here: whether the deleted ride is counted depends on whether it was
      // the flagged one, and the kept ride starts counting once unflagged.
      const affectedBikeIds = await prisma.$transaction(async (tx) => {
        // Capture BEFORE the delete — adjustment rows cascade away with the
        // ride, and cross-bike INCLUDEs live on parts the bikes' recompute
        // below would not reach.
        const adjustedComponentIds = await findAdjustedComponentIdsForRides(tx, [
          deleteRideId,
          keepRideId,
        ]);

        // Delete the duplicate
        await tx.ride.delete({
          where: { id: deleteRideId },
        });

        // Clear duplicate flags on the kept ride
        await tx.ride.update({
          where: { id: keepRideId },
          data: {
            isDuplicate: false,
            duplicateOfId: null,
          },
        });

        return recomputeCountersForBikes(tx, {
          userId,
          bikeIds: rideBikeIds([deleteRide, keepRide]),
          legacyHoursDelta: legacyDebitByBike([deleteRide]),
          componentIds: adjustedComponentIds,
        });
      }, BULK_RECOMPUTE_TX_OPTIONS);

      // Invalidate prediction caches for every bike whose component hours
      // changed — independent cache busts, so fire them together. This runs
      // AFTER the transaction committed, so a bust failure must NOT surface as
      // a 500: the merge already happened and a client retry would then 404 on
      // the deleted ride. Best-effort — the cache TTL backstops any staleness.
      try {
        await Promise.all(
          affectedBikeIds.map((bikeId) => invalidateBikePrediction(userId, bikeId))
        );
      } catch (err) {
        logError('Duplicates merge cache invalidation', err);
      }

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
        select: { userId: true },
      });

      if (!ride) {
        return sendNotFound(res, 'Ride not found');
      }

      if (ride.userId !== userId) {
        return sendForbidden(res, 'Unauthorized');
      }

      // Clear duplicate flags on this ride and any related rides in a
      // transaction. The rides cleared: this one, any other ride pointing to
      // the same primary (marking the duplicate ride), and any ride pointing
      // to this one (marking the primary ride).
      const affectedBikeIds = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the flags may have moved since the
        // ownership check above.
        const current = await tx.ride.findUnique({
          where: { id: rideId },
          select: { duplicateOfId: true },
        });
        const primaryId = current?.duplicateOfId ?? null;
        const cleared = await tx.ride.findMany({
          where: {
            userId,
            OR: [
              { id: rideId },
              ...(primaryId ? [{ duplicateOfId: primaryId }] : []),
              { duplicateOfId: rideId },
            ],
          },
          select: { id: true, bikeId: true },
        });
        const clearedIds = cleared.map((c) => c.id);
        const adjustedComponentIds = await findAdjustedComponentIdsForRides(tx, clearedIds);

        await tx.ride.updateMany({
          where: { userId, id: { in: clearedIds } },
          data: {
            isDuplicate: false,
            duplicateOfId: null,
          },
        });

        // The cleared rides count again.
        return recomputeCountersForBikes(tx, {
          userId,
          bikeIds: rideBikeIds(cleared),
          componentIds: adjustedComponentIds,
        });
      }, BULK_RECOMPUTE_TX_OPTIONS);

      // Post-commit and best-effort, as in the merge route.
      try {
        await Promise.all(
          affectedBikeIds.map((bikeId) => invalidateBikePrediction(userId, bikeId))
        );
      } catch (err) {
        logError('Duplicates mark-not-duplicate cache invalidation', err);
      }

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
        bikeId: true,
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

    // Update database with duplicate relationships using transaction for
    // atomicity. A flagged ride stops counting toward its parts, so the
    // flagged rides' bikes are recomputed in the same transaction.
    if (validPairs.length > 0) {
      const rideById = new Map(allRides.map((ride) => [ride.id, ride]));
      const flagged = validPairs.map((pair) => rideById.get(pair.duplicateId)!);

      const affectedBikeIds = await prisma.$transaction(async (tx) => {
        for (const pair of validPairs) {
          await tx.ride.update({
            where: { id: pair.duplicateId },
            data: {
              isDuplicate: true,
              duplicateOfId: pair.primaryId,
            },
          });
        }

        return recomputeCountersForBikes(tx, {
          userId,
          bikeIds: rideBikeIds(flagged),
          componentIds: await findAdjustedComponentIdsForRides(
            tx,
            validPairs.map((pair) => pair.duplicateId)
          ),
        });
      }, BULK_RECOMPUTE_TX_OPTIONS);

      // Post-commit and best-effort, as in the merge route.
      try {
        await Promise.all(
          affectedBikeIds.map((bikeId) => invalidateBikePrediction(userId, bikeId))
        );
      } catch (err) {
        logError('Duplicates scan cache invalidation', err);
      }
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
 * Auto-merge all duplicates based on user's preferred data source.
 * Supported preferences: garmin, strava, whoop, suunto. Non-fitness auth
 * providers on `activeDataSource` (apple/google) are rejected.
 */

// activeDataSource is an `AuthProvider` enum including apple/google, but only
// the four fitness providers have ride-data IDs to prefer.
const FITNESS_PROVIDERS = ['garmin', 'strava', 'whoop', 'suunto'] as const;
type FitnessProvider = (typeof FITNESS_PROVIDERS)[number];

const PROVIDER_LABELS: Record<FitnessProvider, string> = {
  garmin: 'Garmin',
  strava: 'Strava',
  whoop: 'WHOOP',
  suunto: 'Suunto',
};

type RideProviderIds = {
  garminActivityId: string | null;
  stravaActivityId: string | null;
  whoopWorkoutId: string | null;
  suuntoWorkoutId: string | null;
};

function isFromProvider(ride: RideProviderIds, provider: FitnessProvider): boolean {
  switch (provider) {
    case 'garmin': return !!ride.garminActivityId;
    case 'strava': return !!ride.stravaActivityId;
    case 'whoop':  return !!ride.whoopWorkoutId;
    case 'suunto': return !!ride.suuntoWorkoutId;
  }
}

r.post('/duplicates/auto-merge', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });

    if (!user?.activeDataSource) {
      return sendBadRequest(res, 'No active data source set. Please set your preferred data source in Settings before auto-merging.');
    }

    if (!FITNESS_PROVIDERS.includes(user.activeDataSource as FitnessProvider)) {
      return sendBadRequest(res, 'Active data source must be a fitness provider (Garmin, Strava, WHOOP, or Suunto) to auto-merge.');
    }

    const preferredSource = user.activeDataSource as FitnessProvider;

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
        whoopWorkoutId: true,
        suuntoWorkoutId: true,
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
        whoopWorkoutId: true,
        suuntoWorkoutId: true,
      },
    });
    const primaryRideMap = new Map(primaryRides.map(r => [r.id, r]));

    const deletedRides: Array<RideBike & { id: string; durationSeconds: number | null }> = [];

    for (const dupRide of duplicateRides) {
      const primaryRide = primaryRideMap.get(dupRide.duplicateOfId!);
      if (!primaryRide) continue;

      // Determine which side comes from the preferred source
      const dupIsFromPreferred = isFromProvider(dupRide, preferredSource);
      const primaryIsFromPreferred = isFromProvider(primaryRide, preferredSource);

      let rideToDelete: typeof dupRide | typeof primaryRide;

      if (dupIsFromPreferred && !primaryIsFromPreferred) {
        // Keep duplicate, delete primary
        rideToDelete = primaryRide;
      } else {
        // Keep primary, delete duplicate (covers: both-preferred, neither-preferred,
        // and primary-only-preferred). Falling through to the primary when neither
        // side matches preserves the scan's earliest-seen primary choice.
        rideToDelete = dupRide;
      }

      deletedRides.push(rideToDelete);
    }
    const ridesToDelete = deletedRides.map((ride) => ride.id);

    // Perform deletions in transaction
    const affectedBikeIds = await prisma.$transaction(async (tx) => {
      // Capture BEFORE the deleteMany — adjustment rows cascade away with
      // their rides, and cross-bike INCLUDEs live on parts the bikes'
      // recompute below would not reach.
      const adjustedComponentIds = await findAdjustedComponentIdsForRides(tx, ridesToDelete);

      // Every flagged ride is cleared below and starts counting again, so its
      // bike is recomputed along with the deleted rides' bikes.
      // The same set the final updateMany clears; one row per bike is enough.
      const flagged = await tx.ride.findMany({
        where: { userId, isDuplicate: true },
        select: { bikeId: true },
        distinct: ['bikeId'],
      });

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

      return recomputeCountersForBikes(tx, {
        userId,
        bikeIds: rideBikeIds([...deletedRides, ...flagged]),
        legacyHoursDelta: legacyDebitByBike(deletedRides),
        componentIds: adjustedComponentIds,
      });
    }, BULK_RECOMPUTE_TX_OPTIONS);

    // Invalidate prediction caches for every bike whose component hours
    // changed. Post-commit best-effort: a bust failure must not turn the
    // committed merge into a client-visible 500 (a retry would re-scan
    // against already-deleted rides).
    try {
      await Promise.all(
        affectedBikeIds.map((bikeId) => invalidateBikePrediction(userId, bikeId))
      );
    } catch (err) {
      logError('Duplicates auto-merge cache invalidation', err);
    }

    console.log(`[Duplicates] Auto-merge completed for user ${userId}: merged ${ridesToDelete.length} pairs, preferred: ${preferredSource}`);

    return res.json({
      success: true,
      merged: ridesToDelete.length,
      preferredSource,
      message: `Merged ${ridesToDelete.length} duplicate rides, keeping ${PROVIDER_LABELS[preferredSource]} data`,
    });
  } catch (error) {
    logError('Duplicates auto-merge', error);
    return sendInternalError(res, 'Failed to auto-merge duplicates');
  }
});

export default r;
