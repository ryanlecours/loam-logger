import { prisma } from './prisma';
import { logger } from './logger';
import {
  syncBikeComponentHours,
  findAdjustedComponentIdsForRides,
  recomputeAdjustedComponentsForRides,
} from './component-hours';
import { invalidateBikePredictionsForBikes } from '../services/prediction/cache';
import { garminRideKey } from './garmin-ride-key';

/**
 * Remove the ride behind a Garmin activity that is no longer a bike ride.
 *
 * A rider can edit an activity's type in Garmin Connect after it synced. When
 * they change one away from cycling they are saying it was never a ride, so
 * leaving it behind would keep crediting its hours against installed components
 * and inflate every service prediction that depends on them. Skipping the
 * activity, which is what the cycling filters used to do on their own, is
 * silent and permanent.
 *
 * Mirrors the Strava delete path in routes/webhooks.strava.ts, including the
 * ordering that matters: cross-bike component adjustments are captured BEFORE
 * the delete, because those rows cascade away with the ride and the bulk
 * decrement never touches the components they point at.
 *
 * Idempotent and safe to call for any non-cycling activity. Most have no ride
 * at all, which is a single indexed lookup and no write.
 *
 * @returns whether a ride was actually removed.
 */
export async function removeGarminRideIfPresent(
  userId: string,
  summaryId: string
): Promise<boolean> {
  // Normalized here rather than at the call sites: a retype can be announced by
  // either summary type, and an "-detail" id would otherwise find no row and
  // report that nothing was removed while the ride kept accruing hours.
  const garminActivityId = garminRideKey(summaryId);

  // Removal and affected bikes are tracked separately: an unassigned ride is
  // still deleted but moves nobody's hours, so an empty bike list must not read
  // as "nothing happened".
  const { removed, affectedBikeIds } = await prisma.$transaction(async (tx) => {
    const existing = await tx.ride.findUnique({
      where: { garminActivityId },
      select: { id: true, userId: true, durationSeconds: true, bikeId: true },
    });

    // Scoped to the owner as well as the activity id. The id is unique, so this
    // only fires if a row were ever attributed to the wrong account, but a
    // delete is not the place to assume that cannot happen.
    if (!existing || existing.userId !== userId) {
      return { removed: false, affectedBikeIds: [] as string[] };
    }

    const adjustedComponentIds = await findAdjustedComponentIdsForRides(tx, [existing.id]);

    const affected = await syncBikeComponentHours(
      tx,
      userId,
      { bikeId: existing.bikeId ?? null, durationSeconds: existing.durationSeconds },
      { bikeId: null, durationSeconds: 0 }
    );

    await tx.ride.delete({ where: { id: existing.id } });

    const adjustedBikeIds = await recomputeAdjustedComponentsForRides(tx, {
      componentIds: adjustedComponentIds,
    });

    logger.info(
      {
        event: 'garmin_ride_removed_type_changed',
        userId,
        garminActivityId,
        rideId: existing.id,
        bikeId: existing.bikeId,
        durationSeconds: existing.durationSeconds,
      },
      '[GarminRideRemoval] Removed ride whose Garmin activity is no longer cycling'
    );

    return { removed: true, affectedBikeIds: [...affected, ...adjustedBikeIds] };
  });

  if (affectedBikeIds.length > 0) {
    // The hours behind these predictions just changed; a stale cache would keep
    // serving the ride's contribution after the ride itself is gone.
    await invalidateBikePredictionsForBikes(userId, affectedBikeIds);
  }

  return removed;
}
