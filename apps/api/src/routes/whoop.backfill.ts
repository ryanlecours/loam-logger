import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidWhoopToken } from '../lib/whoop-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';
import {
  WHOOP_API_BASE,
  WHOOP_CYCLING_SPORT_IDS,
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
 */
r.get<Empty, void, Empty, { year?: string }>(
  '/whoop/backfill/fetch',
  async (req: Request<Empty, void, Empty, { year?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const currentYear = new Date().getFullYear();
      const yearParam = req.query.year;

      let startDate: Date;
      let endDate: Date;

      if (yearParam === 'ytd') {
        // Year-to-date: Jan 1 of current year to now
        startDate = new Date(currentYear, 0, 1); // Jan 1
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

      // Get valid OAuth token
      const accessToken = await getValidWhoopToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'WHOOP not connected or token expired. Please reconnect your WHOOP account.');
      }

      console.log(`[WHOOP Backfill] Fetching ${yearParam || currentYear} workouts from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Fetch workouts from WHOOP API
      // https://developer.whoop.com/api/#tag/Workout
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
          console.error(`[WHOOP Backfill] Failed to fetch workouts: ${workoutsRes.status} ${text}`);
          throw new Error(`Failed to fetch workouts: ${workoutsRes.status}`);
        }

        const page = (await workoutsRes.json()) as WhoopPaginatedResponse<WhoopWorkout>;
        workouts.push(...page.records);
        nextToken = page.next_token;
        pageCount++;

        console.log(`[WHOOP Backfill] Fetched page ${pageCount}: ${page.records.length} workouts`);

        if (pageCount >= maxPages) {
          console.warn('[WHOOP Backfill] Reached page limit (50), stopping pagination');
          break;
        }
      } while (nextToken);

      console.log(`[WHOOP Backfill] Total workouts fetched: ${workouts.length}`);

      // Filter cycling workouts only
      const cyclingWorkouts = workouts.filter((w) =>
        WHOOP_CYCLING_SPORT_IDS.includes(w.sport_id as typeof WHOOP_CYCLING_SPORT_IDS[number])
      );

      console.log(`[WHOOP Backfill] Cycling workouts: ${cyclingWorkouts.length}`);

      // Import each cycling workout
      let importedCount = 0;
      let skippedCount = 0;

      // Check if user has exactly one bike (auto-assign for WHOOP since it has no gear tagging)
      const userBikes = await prisma.bike.findMany({
        where: { userId },
        select: { id: true },
      });
      const autoAssignBikeId = userBikes.length === 1 ? userBikes[0].id : null;

      for (const workout of cyclingWorkouts) {
        // Check if workout already exists
        const existing = await prisma.ride.findUnique({
          where: { whoopWorkoutId: workout.id.toString() },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        // Skip unscorable workouts (no data available)
        if (workout.score_state === 'UNSCORABLE') {
          console.log(`[WHOOP Backfill] Skipping unscorable workout ${workout.id}`);
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

        await prisma.$transaction(async (tx) => {
          await tx.ride.create({
            data: {
              userId,
              whoopWorkoutId: workout.id.toString(),
              startTime,
              durationSeconds,
              distanceMiles,
              elevationGainFeet,
              averageHr: workout.score?.average_heart_rate
                ? Math.round(workout.score.average_heart_rate)
                : null,
              rideType: 'Cycling', // WHOOP sport_id 1 = Cycling
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

      console.log(`[WHOOP Backfill] Imported: ${importedCount}, Skipped (existing/unscorable): ${skippedCount}`);

      // Track backfill request in database
      const yearKey = yearParam || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'whoop', year: yearKey } },
          update: {
            status: 'completed',
            ridesFound: importedCount,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            userId,
            provider: 'whoop',
            year: yearKey,
            status: 'completed',
            ridesFound: importedCount,
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

      return res.json({
        success: true,
        recentRides: recentWhoopRides,
        totalWhoopRides,
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
