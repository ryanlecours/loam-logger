import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidWhoopToken } from '../lib/whoop-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { logError, logger } from '../lib/logger';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { findPotentialDuplicates, type DuplicateCandidate } from '../lib/duplicate-detector';
import {
  WHOOP_API_BASE,
  isWhoopCyclingWorkout,
  getWhoopRideType,
  type WhoopWorkout,
  type WhoopPaginatedResponse,
} from '../types/whoop';

type Empty = Record<string, never>;
const r: Router = createRouter();

// Minimum year for backfill requests
const MIN_BACKFILL_YEAR = 2015;

/**
 * Fetch historical workouts from WHOOP for a given time period
 * Returns activities that have been imported
 *
 * Enhancements:
 * - Uses v2 API with UUID workout IDs
 * - Supports Mountain Biking (sport_id=57) and sport_name filtering
 * - Incremental YTD backfill with checkpointing
 * - Cross-provider duplicate detection
 * - Distributed locking to prevent concurrent backfills
 */
r.get<Empty, void, Empty, { year?: string }>(
  '/whoop/backfill/fetch',
  async (req: Request<Empty, void, Empty, { year?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    // Acquire lock to prevent concurrent backfills
    const lockResult = await acquireLock('backfill', 'whoop', userId);
    if (!lockResult.acquired) {
      return sendBadRequest(res, 'A WHOOP backfill is already in progress. Please wait for it to complete.');
    }

    try {
      const currentYear = new Date().getFullYear();
      const yearParam = req.query.year;

      let startDate: Date;
      let endDate: Date;

      if (yearParam === 'ytd') {
        // Check for existing checkpoint for incremental YTD backfill
        const existingYtd = await prisma.backfillRequest.findUnique({
          where: { userId_provider_year: { userId, provider: 'whoop', year: 'ytd' } },
        });

        if (existingYtd?.backfilledUpTo && existingYtd.status === 'completed') {
          // Resume from last checkpoint + 1 second
          startDate = new Date(existingYtd.backfilledUpTo.getTime() + 1000);
          logger.info({ userId, startDate: startDate.toISOString() }, '[WHOOP Backfill] Resuming YTD from checkpoint');
        } else {
          startDate = new Date(currentYear, 0, 1); // Jan 1
        }
        endDate = new Date(); // Now
      } else {
        // Specific year: Jan 1 to Dec 31
        const year = parseInt(yearParam || String(currentYear), 10);
        if (isNaN(year) || year < MIN_BACKFILL_YEAR || year > currentYear) {
          return sendBadRequest(res, `Year must be between ${MIN_BACKFILL_YEAR} and ${currentYear}, or 'ytd'`);
        }
        startDate = new Date(year, 0, 1); // Jan 1
        endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31 end of day
      }

      // If start date is after end date (already fully backfilled), return early
      if (startDate >= endDate) {
        return res.json({
          success: true,
          message: 'YTD backfill is already up to date.',
          totalWorkouts: 0,
          cyclingWorkouts: 0,
          imported: 0,
          skipped: 0,
          duplicatesDetected: 0,
          autoAssignedBike: false,
        });
      }

      // Get valid OAuth token
      const accessToken = await getValidWhoopToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'WHOOP not connected or token expired. Please reconnect your WHOOP account.');
      }

      logger.info(
        { userId, yearParam: yearParam || currentYear, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        '[WHOOP Backfill] Starting fetch'
      );

      // Fetch workouts from WHOOP API v2
      const workouts: WhoopWorkout[] = [];
      let nextToken: string | undefined;
      let pageCount = 0;
      const maxPages = 50; // Safety limit

      do {
        const url = new URL(`${WHOOP_API_BASE}/activity/workout`);
        url.searchParams.set('start', startDate.toISOString());
        url.searchParams.set('end', endDate.toISOString());
        url.searchParams.set('limit', '25'); // WHOOP default/max is 25
        if (nextToken) {
          url.searchParams.set('nextToken', nextToken);
        }

        const workoutsRes = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!workoutsRes.ok) {
          const text = await workoutsRes.text();
          logger.error({ status: workoutsRes.status, text }, '[WHOOP Backfill] Failed to fetch workouts');
          throw new Error(`Failed to fetch workouts: ${workoutsRes.status}`);
        }

        const page = (await workoutsRes.json()) as WhoopPaginatedResponse<WhoopWorkout>;
        workouts.push(...page.records);
        nextToken = page.next_token;
        pageCount++;

        logger.debug({ pageCount, recordsOnPage: page.records.length }, '[WHOOP Backfill] Fetched page');

        if (pageCount >= maxPages) {
          logger.warn({ maxPages }, '[WHOOP Backfill] Reached page limit, stopping pagination');
          break;
        }
      } while (nextToken);

      logger.info({ totalWorkouts: workouts.length }, '[WHOOP Backfill] Total workouts fetched');

      // Filter cycling workouts using sport_name and sport_id
      const cyclingWorkouts = workouts.filter(isWhoopCyclingWorkout);

      logger.info({ cyclingWorkouts: cyclingWorkouts.length }, '[WHOOP Backfill] Cycling workouts found');

      // Import each cycling workout
      let importedCount = 0;
      let skippedCount = 0;
      let duplicatesDetected = 0;

      // Check if user has exactly one bike (auto-assign for WHOOP since it has no gear tagging)
      const userBikes = await prisma.bike.findMany({
        where: { userId },
        select: { id: true },
      });
      const autoAssignBikeId = userBikes.length === 1 ? userBikes[0].id : null;

      for (const workout of cyclingWorkouts) {
        // Check if workout already exists by WHOOP ID
        const existing = await prisma.ride.findUnique({
          where: { whoopWorkoutId: workout.id },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        // Skip unscorable workouts (no data available)
        if (workout.score_state === 'UNSCORABLE') {
          logger.debug({ workoutId: workout.id }, '[WHOOP Backfill] Skipping unscorable workout');
          skippedCount++;
          continue;
        }

        // Convert workout to Ride format
        const startTime = new Date(workout.start);
        const endTime = new Date(workout.end);
        const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
        const durationHours = Math.max(0, durationSeconds) / 3600;

        // Convert WHOOP metrics (meters to miles, meters to feet)
        const distanceMiles = workout.score?.distance_meter
          ? workout.score.distance_meter * 0.000621371
          : 0;
        const elevationGainFeet = workout.score?.altitude_gain_meter
          ? workout.score.altitude_gain_meter * 3.28084
          : 0;

        // Check for cross-provider duplicates
        const duplicateCandidate: DuplicateCandidate = {
          id: '',
          startTime,
          durationSeconds,
          distanceMiles,
          elevationGainFeet,
          garminActivityId: null,
          stravaActivityId: null,
          whoopWorkoutId: workout.id,
        };

        const duplicate = await findPotentialDuplicates(userId, duplicateCandidate, prisma);
        if (duplicate) {
          logger.info(
            { workoutId: workout.id, duplicateRideId: duplicate.id },
            '[WHOOP Backfill] Skipping duplicate of existing ride'
          );
          duplicatesDetected++;
          skippedCount++;
          continue;
        }

        // Get ride type based on sport
        const rideType = getWhoopRideType(workout);

        await prisma.$transaction(async (tx) => {
          await tx.ride.create({
            data: {
              userId,
              whoopWorkoutId: workout.id,
              startTime,
              durationSeconds,
              distanceMiles,
              elevationGainFeet,
              averageHr: workout.score?.average_heart_rate
                ? Math.round(workout.score.average_heart_rate)
                : null,
              rideType,
              bikeId: autoAssignBikeId,
            },
          });

          // Update component hours if bike is assigned
          if (autoAssignBikeId && durationHours > 0) {
            await tx.component.updateMany({
              where: { userId, bikeId: autoAssignBikeId },
              data: { hoursUsed: { increment: durationHours } },
            });
          }
        });

        importedCount++;
      }

      logger.info(
        { imported: importedCount, skipped: skippedCount, duplicatesDetected },
        '[WHOOP Backfill] Import complete'
      );

      // Track backfill request in database with checkpoint
      const yearKey = yearParam || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'whoop', year: yearKey } },
          update: {
            status: 'completed',
            ridesFound: { increment: importedCount },
            backfilledUpTo: endDate, // Checkpoint for incremental backfill
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            userId,
            provider: 'whoop',
            year: yearKey,
            status: 'completed',
            ridesFound: importedCount,
            backfilledUpTo: endDate,
            completedAt: new Date(),
          },
        });
      } catch (dbError) {
        logError('WHOOP Backfill DB tracking', dbError);
        // Don't fail the request if tracking fails
      }

      return res.json({
        success: true,
        message: `Successfully imported ${importedCount} rides from WHOOP.`,
        totalWorkouts: workouts.length,
        cyclingWorkouts: cyclingWorkouts.length,
        imported: importedCount,
        skipped: skippedCount,
        duplicatesDetected,
        autoAssignedBike: autoAssignBikeId !== null,
      });
    } catch (error) {
      // Track failed backfill
      const yearKey = req.query.year || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'whoop', year: yearKey } },
          update: { status: 'failed', updatedAt: new Date() },
          create: { userId, provider: 'whoop', year: yearKey, status: 'failed' },
        });
      } catch {
        // Ignore tracking errors
      }
      logError('WHOOP Backfill', error);
      return sendInternalError(res, 'Failed to fetch workouts');
    } finally {
      // Always release the lock
      await releaseLock('backfill', 'whoop', userId, lockResult.lockValue);
    }
  }
);

/**
 * Check recent WHOOP ride imports
 * Useful for debugging backfill issues
 */
r.get<Empty, void, Empty, Empty>(
  '/whoop/backfill/status',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      // Get recent rides imported from WHOOP (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30);
      const recentWhoopRides = await prisma.ride.findMany({
        where: {
          userId,
          whoopWorkoutId: { not: null },
          startTime: { gte: thirtyDaysAgo },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: {
          id: true,
          whoopWorkoutId: true,
          startTime: true,
          rideType: true,
          distanceMiles: true,
          createdAt: true,
        },
      });

      // Get total WHOOP rides for this user
      const totalWhoopRides = await prisma.ride.count({
        where: {
          userId,
          whoopWorkoutId: { not: null },
        },
      });

      // Get backfill checkpoint info
      const ytdBackfill = await prisma.backfillRequest.findUnique({
        where: { userId_provider_year: { userId, provider: 'whoop', year: 'ytd' } },
        select: { status: true, backfilledUpTo: true, ridesFound: true, completedAt: true },
      });

      return res.json({
        success: true,
        recentRides: recentWhoopRides,
        totalWhoopRides,
        ytdBackfill,
        message: `Found ${recentWhoopRides.length} recent WHOOP rides (last 30 days), ${totalWhoopRides} total`,
      });
    } catch (error) {
      logError('WHOOP Backfill Status', error);
      return sendInternalError(res, 'Failed to fetch backfill status');
    }
  }
);

/**
 * Testing/utility endpoint: Delete all WHOOP-imported rides for the current user.
 * Also removes the recorded hours from associated bikes/components.
 */
r.delete<Empty, void, Empty>(
  '/whoop/testing/delete-imported-rides',
  async (req: Request, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const rides = await prisma.ride.findMany({
        where: {
          userId,
          whoopWorkoutId: { not: null },
        },
        select: { id: true, durationSeconds: true, bikeId: true },
      });

      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: 'No WHOOP rides to delete',
        });
      }

      const hoursByBike = rides.reduce<Map<string, number>>((map, ride) => {
        if (ride.bikeId) {
          const hours = Math.max(0, ride.durationSeconds ?? 0) / 3600;
          map.set(ride.bikeId, (map.get(ride.bikeId) ?? 0) + hours);
        }
        return map;
      }, new Map());

      await prisma.$transaction(async (tx) => {
        for (const [bikeId, hours] of hoursByBike.entries()) {
          if (hours <= 0) continue;
          await tx.component.updateMany({
            where: { userId, bikeId },
            data: { hoursUsed: { decrement: hours } },
          });
          await tx.component.updateMany({
            where: { userId, bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 },
          });
        }

        await tx.ride.deleteMany({
          where: {
            userId,
            whoopWorkoutId: { not: null },
          },
        });

        // Reset backfill checkpoint
        await tx.backfillRequest.deleteMany({
          where: { userId, provider: 'whoop' },
        });
      });

      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size,
      });
    } catch (error) {
      logError('WHOOP Delete Rides', error);
      return sendInternalError(res, 'Failed to delete WHOOP rides');
    }
  }
);

export default r;
