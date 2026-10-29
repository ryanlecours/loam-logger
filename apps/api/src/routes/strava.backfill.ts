import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { importStravaActivities, StravaNotConnectedError } from '../lib/strava-backfill';
import { getValidStravaToken } from '../lib/strava-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendInternalError } from '../lib/api-response';
import { canBackfillYear } from '../auth/tier-access';
import {
  findAdjustedComponentIdsForRides,
  recomputeAdjustedComponentsForRides,
} from '../lib/component-hours';
import { recomputeCountersForBike, BULK_RECOMPUTE_TX_OPTIONS } from '../lib/component-counters';
import { invalidateBikePrediction } from '../services/prediction/cache';
import { logError } from '../lib/logger';
import { requireAdmin } from '../auth/adminMiddleware';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Fetch historical activities from Strava for a given time period
 * Returns activities that have been imported
 */
r.get<Empty, void, Empty, { year?: string }>(
  '/strava/backfill/fetch',
  async (req: Request<Empty, void, Empty, { year?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const currentYear = new Date().getFullYear();
      const yearParam = req.query.year;

      // Import depth is tier-gated: free accounts backfill the current year only
      const tierUser = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionTier: true, isFoundingRider: true, role: true },
      });
      if (!canBackfillYear(tierUser, yearParam)) {
        return sendForbidden(
          res,
          'Importing past seasons is a Pro feature. Free accounts can import the current year.',
          'TIER_BACKFILL_RESTRICTED'
        );
      }

      let startDate: Date;
      let endDate: Date;

      if (yearParam === 'ytd') {
        // Year-to-date: Jan 1 of current year to now
        startDate = new Date(currentYear, 0, 1); // Jan 1
        endDate = new Date(); // Now
      } else {
        // Specific year: Jan 1 to Dec 31
        const year = parseInt(yearParam || String(currentYear), 10);
        if (isNaN(year) || year < 2000 || year > currentYear) {
          return sendBadRequest(res, `Year must be between 2000 and ${currentYear}, or 'ytd'`);
        }
        startDate = new Date(year, 0, 1); // Jan 1
        endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31 end of day
      }

      let summary;
      try {
        summary = await importStravaActivities({ userId, startDate, endDate, via: 'sync' });
      } catch (err) {
        if (err instanceof StravaNotConnectedError) {
          return sendBadRequest(res, err.message);
        }
        throw err;
      }

      // Track backfill request in database
      const yearKey = yearParam || 'ytd';
      // Semantics note: before the gap-fill rework, `ridesFound` meant
      // "new rides created this run" (existing rides were silently skipped
      // and excluded). It now means "rides touched this run" — new + updated.
      // This is what the history UI on web/mobile wants ("N rides synced"),
      // and without this change, a re-sync of a user's full history would
      // show 0 here and look broken. WHOOP still tracks new-only because
      // there's no gap-fill path on that provider.
      const touchedCount = summary.imported + summary.updated;
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'strava', year: yearKey } },
          update: {
            status: 'completed',
            ridesFound: touchedCount,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            userId,
            provider: 'strava',
            year: yearKey,
            status: 'completed',
            ridesFound: touchedCount,
            completedAt: new Date(),
          },
        });
      } catch (dbError) {
        logError('Strava Sync DB tracking', dbError);
        // Don't fail the request if tracking fails
      }

      return res.json({
        success: true,
        message: `Synced ${summary.imported} new and ${summary.updated} updated rides from Strava.`,
        totalActivities: summary.totalActivities,
        cyclingActivities: summary.cyclingActivities,
        imported: summary.imported,
        updated: summary.updated,
        // Legacy alias for `updated`, kept so older clients that read
        // `response.skipped` (pre-gap-fill, when existing rides were
        // silently skipped) still get a number rather than undefined. The
        // meaning has shifted — it's now the count of existing rides that
        // were touched — which is actually closer to what users cared
        // about anyway. New clients should read `updated`.
        skipped: summary.updated,
        geocoded: summary.geocoded,
        unmappedGears: summary.unmappedGears,
      });
    } catch (error) {
      // Track failed backfill - use req.query.year since yearParam is scoped to try block
      const yearKey = req.query.year || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'strava', year: yearKey } },
          update: { status: 'failed', updatedAt: new Date() },
          create: { userId, provider: 'strava', year: yearKey, status: 'failed' },
        });
      } catch {
        // Ignore tracking errors
      }
      logError('Strava Sync', error);
      return sendInternalError(res, 'Failed to fetch activities');
    }
  }
);
r.get<Empty, void, Empty, Empty>(
  '/strava/backfill/strava-athlete-id',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider: 'strava',
        },
        select: {
          providerUserId: true,
        },
      });

      if (!userAccount) {
        return sendNotFound(res, 'Strava account not connected');
      }

      return res.json({
        stravaAthleteId: userAccount.providerUserId,
        message: 'Your Strava athlete ID',
      });
    } catch (error) {
      logError('Strava Athlete ID', error);
      return sendInternalError(res, 'Failed to fetch Strava athlete ID');
    }
  }
);

/**
 * Check recent Strava ride imports
 * Useful for debugging backfill issues
 */
r.get<Empty, void, Empty, Empty>(
  '/strava/backfill/status',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      // Get recent rides imported from Strava (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30);
      const recentStravaRides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null },
          startTime: { gte: thirtyDaysAgo },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: {
          id: true,
          stravaActivityId: true,
          startTime: true,
          rideType: true,
          distanceMeters: true,
          createdAt: true,
        },
      });

      // Get total Strava rides for this user
      const totalStravaRides = await prisma.ride.count({
        where: {
          userId,
          stravaActivityId: { not: null },
        },
      });

      return res.json({
        success: true,
        recentRides: recentStravaRides,
        totalStravaRides,
        message: `Found ${recentStravaRides.length} recent Strava rides (last 30 days), ${totalStravaRides} total`,
      });
    } catch (error) {
      logError('Strava Sync Status', error);
      return sendInternalError(res, 'Failed to fetch backfill status');
    }
  }
);

/**
 * Fetch Strava gear details
 */
r.get<{ gearId: string }, void, Empty, Empty>(
  '/strava/gear/:gearId',
  async (req: Request<{ gearId: string }, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const { gearId } = req.params;
      const accessToken = await getValidStravaToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'Strava not connected');
      }

      const gearUrl = `https://www.strava.com/api/v3/gear/${gearId}`;
      const gearRes = await fetch(gearUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!gearRes.ok) {
        return sendNotFound(res, 'Gear not found');
      }

      const gear = (await gearRes.json()) as {
        id: string;
        name: string;
        brand_name?: string;
        model_name?: string;
      };

      return res.json({
        id: gear.id,
        name: gear.name,
        brand: gear.brand_name,
        model: gear.model_name,
      });
    } catch (error) {
      logError('Strava Gear', error);
      return sendInternalError(res, 'Failed to fetch gear');
    }
  }
);

/**
 * Testing/utility endpoint: Delete all Strava-imported rides for the current user.
 * Also removes the recorded hours from associated bikes/components.
 *
 * Admin-gated: the "testing" path component does not provide any access
 * control on its own; the UI hides the button behind isAdmin, but the
 * backend must enforce the same boundary to prevent accidental or
 * malicious wipes (e.g., a frontend bug or a non-admin discovering the route).
 */
r.delete<Empty, void, Empty>(
  '/strava/testing/delete-imported-rides',
  requireAdmin,
  async (req: Request, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const rides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null },
        },
        select: { id: true, durationSeconds: true, bikeId: true },
      });

      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: 'No Strava rides to delete',
        });
      }

      const hoursByBike = rides.reduce<Map<string, number>>((map, ride) => {
        if (ride.bikeId) {
          const hours = Math.max(0, ride.durationSeconds ?? 0) / 3600;
          map.set(ride.bikeId, (map.get(ride.bikeId) ?? 0) + hours);
        }
        return map;
      }, new Map());

      const adjustedBikeIds = await prisma.$transaction(async (tx) => {
        // Capture BEFORE the deleteMany — adjustment rows cascade away with
        // their rides; adjusted components (incl. cross-bike INCLUDEs) need
        // a canonical recompute after the purge.
        const adjustedComponentIds = await findAdjustedComponentIdsForRides(
          tx,
          rides.map((r) => r.id)
        );

        await tx.ride.deleteMany({
          where: {
            userId,
            stravaActivityId: { not: null },
          },
        });

        // Many rides at once: one recompute per part that has been on each
        // bike, after the rides are gone, beats a debit per ride.
        const recomputedBikes: string[] = [];
        for (const [bikeId, hours] of hoursByBike.entries()) {
          recomputedBikes.push(
            ...(await recomputeCountersForBike(tx, { userId, bikeId, legacyHoursDelta: -hours }))
          );
        }

        return [
          ...recomputedBikes,
          ...(await recomputeAdjustedComponentsForRides(tx, { componentIds: adjustedComponentIds })),
        ];
      }, BULK_RECOMPUTE_TX_OPTIONS);

      // Invalidate prediction caches for every bike whose component hours
      // changed — the decremented bikes plus any bike holding a component
      // with cross-bike INCLUDE adjustments (mirrors duplicates auto-merge).
      for (const bikeId of new Set([...hoursByBike.keys(), ...adjustedBikeIds])) {
        await invalidateBikePrediction(userId, bikeId);
      }

      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size,
      });
    } catch (error) {
      logError('Strava Delete Rides', error);
      return sendInternalError(res, 'Failed to delete Strava rides');
    }
  }
);

export default r;
