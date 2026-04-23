import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { getValidSuuntoToken } from '../lib/suunto-token';
import {
  sendBadRequest,
  sendUnauthorized,
  sendInternalError,
} from '../lib/api-response';
import {
  incrementBikeComponentHours,
  decrementBikeComponentHours,
} from '../lib/component-hours';
import { logError, logger } from '../lib/logger';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import {
  findPotentialDuplicates,
  type DuplicateCandidate,
} from '../lib/duplicate-detector';
import { isSuuntoCyclingActivity, getSuuntoRideType } from '../types/suunto';
import { suuntoApiHeaders } from '../lib/suunto-sync';
import { enqueueBackfillJob } from '../lib/queue/backfill.queue';
import { requireAdmin } from '../auth/adminMiddleware';

type Empty = Record<string, never>;
const r: Router = createRouter();

const SUUNTO_API_BASE = 'https://cloudapi.suunto.com/v3';
const MIN_BACKFILL_YEAR = 2015;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

// Shape of an individual workout as returned by GET /v3/workouts. Matches the
// webhook WORKOUT_CREATED payload — timestamps are epoch ms, distances meters,
// durations seconds.
interface SuuntoWorkout {
  workoutKey: string;
  activityId: number;
  startTime: number;
  totalTime: number;
  totalDistance?: number;
  totalAscent?: number;
  totalDescent?: number;
  startPosition?: { x: number; y: number };
  hrdata?: { workoutAvgHR?: number; workoutMaxHR?: number };
  timeOffsetInMinutes?: number;
}

// Suunto CloudAPI v3 wraps list responses in { error, metadata, payload }.
interface SuuntoWorkoutsResponse {
  error: unknown;
  metadata?: { totalCount?: number } & Record<string, unknown>;
  payload: SuuntoWorkout[];
}

/**
 * Fetch historical workouts from Suunto for a given year or YTD.
 *
 * - Uses GET /v3/workouts with since/until in epoch ms
 * - Paginates via limit/offset (Suunto does not return a cursor)
 * - Omits filter-by-modification-time so since/until filter by start time
 * - Incremental YTD backfill with BackfillRequest.backfilledUpTo checkpoint
 * - Distributed lock prevents overlapping backfills per user
 * - Cross-provider duplicate detection against Garmin/Strava/WHOOP rides
 * - Filters to cycling activities only (road, MTB, indoor) via isSuuntoCyclingActivity
 */
r.get<Empty, void, Empty, { year?: string }>(
  '/suunto/backfill/fetch',
  async (
    req: Request<Empty, void, Empty, { year?: string }>,
    res: Response
  ) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const lockResult = await acquireLock('backfill', 'suunto', userId);
    if (!lockResult.acquired) {
      return sendBadRequest(
        res,
        'A Suunto backfill is already in progress. Please wait for it to complete.'
      );
    }

    try {
      const currentYear = new Date().getFullYear();
      const yearParam = req.query.year;

      let startDate: Date;
      let endDate: Date;

      if (yearParam === 'ytd') {
        const existingYtd = await prisma.backfillRequest.findUnique({
          where: {
            userId_provider_year: { userId, provider: 'suunto', year: 'ytd' },
          },
        });

        if (existingYtd?.backfilledUpTo && existingYtd.status === 'completed') {
          startDate = new Date(existingYtd.backfilledUpTo.getTime() + 1000);
          logger.info(
            { userId, startDate: startDate.toISOString() },
            '[Suunto Backfill] Resuming YTD from checkpoint'
          );
        } else {
          startDate = new Date(currentYear, 0, 1);
        }
        endDate = new Date();
      } else {
        const year = parseInt(yearParam || String(currentYear), 10);
        if (isNaN(year) || year < MIN_BACKFILL_YEAR || year > currentYear) {
          return sendBadRequest(
            res,
            `Year must be between ${MIN_BACKFILL_YEAR} and ${currentYear}, or 'ytd'`
          );
        }
        startDate = new Date(year, 0, 1);
        endDate = new Date(year, 11, 31, 23, 59, 59);
      }

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

      const accessToken = await getValidSuuntoToken(userId);
      if (!accessToken) {
        return sendBadRequest(
          res,
          'Suunto not connected or token expired. Please reconnect your Suunto account.'
        );
      }

      logger.info(
        {
          userId,
          yearParam: yearParam || currentYear,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        '[Suunto Backfill] Starting fetch'
      );

      const workouts: SuuntoWorkout[] = [];
      let offset = 0;
      let pageCount = 0;

      while (pageCount < MAX_PAGES) {
        const url = new URL(`${SUUNTO_API_BASE}/workouts`);
        url.searchParams.set('since', String(startDate.getTime()));
        url.searchParams.set('until', String(endDate.getTime()));
        url.searchParams.set('limit', String(PAGE_LIMIT));
        url.searchParams.set('offset', String(offset));

        const apiRes = await fetch(url.toString(), {
          headers: suuntoApiHeaders(accessToken),
        });

        if (!apiRes.ok) {
          const text = await apiRes.text();
          logger.error(
            { status: apiRes.status, text: text.slice(0, 500) },
            '[Suunto Backfill] Failed to fetch workouts'
          );
          throw new Error(`Failed to fetch workouts: ${apiRes.status}`);
        }

        const page = (await apiRes.json()) as SuuntoWorkoutsResponse;
        const records = page.payload ?? [];
        workouts.push(...records);
        pageCount++;

        logger.debug(
          { pageCount, offset, recordsOnPage: records.length },
          '[Suunto Backfill] Fetched page'
        );

        if (records.length < PAGE_LIMIT) break;
        offset += PAGE_LIMIT;
      }

      if (pageCount >= MAX_PAGES) {
        logger.warn(
          { maxPages: MAX_PAGES, totalFetched: workouts.length },
          '[Suunto Backfill] Hit page cap; some workouts may be missing'
        );
      }

      logger.info(
        { totalWorkouts: workouts.length },
        '[Suunto Backfill] Total workouts fetched'
      );

      const cyclingWorkouts = workouts.filter((w) =>
        isSuuntoCyclingActivity(w.activityId)
      );

      logger.info(
        { cyclingWorkouts: cyclingWorkouts.length },
        '[Suunto Backfill] Cycling workouts found'
      );

      // Suunto has no gear tagging in the list response. Auto-assign to the
      // only bike if the user has exactly one, matching WHOOP behavior.
      const userBikes = await prisma.bike.findMany({
        where: { userId },
        select: { id: true },
      });
      const autoAssignBikeId = userBikes.length === 1 ? userBikes[0].id : null;

      let importedCount = 0;
      let skippedCount = 0;
      let duplicatesDetected = 0;

      for (const workout of cyclingWorkouts) {
        // Same-provider dedup via suuntoWorkoutId unique index.
        const existing = await prisma.ride.findUnique({
          where: { suuntoWorkoutId: workout.workoutKey },
        });
        if (existing) {
          skippedCount++;
          continue;
        }

        const startTime = new Date(workout.startTime);
        const durationSeconds = workout.totalTime;
        const durationHours = Math.max(0, durationSeconds) / 3600;
        const distanceMeters = workout.totalDistance ?? 0;
        const elevationGainMeters = workout.totalAscent ?? 0;
        const averageHr =
          workout.hrdata?.workoutAvgHR != null
            ? Math.round(workout.hrdata.workoutAvgHR)
            : null;
        const startLat = workout.startPosition?.y ?? null;
        const startLng = workout.startPosition?.x ?? null;

        // Cross-provider dedup against Garmin/Strava/WHOOP rides on the same day.
        const duplicateCandidate: DuplicateCandidate = {
          id: '',
          startTime,
          durationSeconds,
          distanceMeters,
          elevationGainMeters,
          garminActivityId: null,
          stravaActivityId: null,
          whoopWorkoutId: null,
          suuntoWorkoutId: workout.workoutKey,
        };

        const duplicate = await findPotentialDuplicates(
          userId,
          duplicateCandidate,
          prisma
        );
        if (duplicate) {
          logger.info(
            { workoutKey: workout.workoutKey, duplicateRideId: duplicate.id },
            '[Suunto Backfill] Skipping duplicate of existing ride'
          );
          duplicatesDetected++;
          skippedCount++;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.ride.create({
            data: {
              userId,
              suuntoWorkoutId: workout.workoutKey,
              startTime,
              durationSeconds,
              distanceMeters,
              elevationGainMeters,
              averageHr,
              rideType: getSuuntoRideType(workout.activityId),
              startLat,
              startLng,
              bikeId: autoAssignBikeId,
            },
          });

          if (autoAssignBikeId) {
            await incrementBikeComponentHours(tx, {
              userId,
              bikeId: autoAssignBikeId,
              hoursDelta: durationHours,
            });
          }
        });

        importedCount++;
      }

      logger.info(
        { imported: importedCount, skipped: skippedCount, duplicatesDetected },
        '[Suunto Backfill] Import complete'
      );

      const yearKey = yearParam || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: {
            userId_provider_year: { userId, provider: 'suunto', year: yearKey },
          },
          update: {
            status: 'completed',
            ridesFound: { increment: importedCount },
            backfilledUpTo: endDate,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            userId,
            provider: 'suunto',
            year: yearKey,
            status: 'completed',
            ridesFound: importedCount,
            backfilledUpTo: endDate,
            completedAt: new Date(),
          },
        });
      } catch (dbError) {
        logError('Suunto Backfill DB tracking', dbError);
      }

      return res.json({
        success: true,
        message: `Successfully imported ${importedCount} rides from Suunto.`,
        totalWorkouts: workouts.length,
        cyclingWorkouts: cyclingWorkouts.length,
        imported: importedCount,
        skipped: skippedCount,
        duplicatesDetected,
        autoAssignedBike: autoAssignBikeId !== null,
      });
    } catch (error) {
      const yearKey = req.query.year || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: {
            userId_provider_year: { userId, provider: 'suunto', year: yearKey },
          },
          update: { status: 'failed', updatedAt: new Date() },
          create: {
            userId,
            provider: 'suunto',
            year: yearKey,
            status: 'failed',
          },
        });
      } catch {
        // Ignore tracking errors
      }
      logError('Suunto Backfill', error);
      return sendInternalError(res, 'Failed to fetch workouts');
    } finally {
      await releaseLock(lockResult.lockKey, lockResult.lockValue);
    }
  }
);

/**
 * Queue multi-year backfill jobs into the backfill worker.
 *
 * The synchronous `/suunto/backfill/fetch` endpoint above blocks for the whole
 * fetch; this endpoint returns immediately after enqueueing one job per year.
 * Mirrors the Garmin pattern so the UI can treat providers uniformly.
 */
r.post<Empty, void, { years: string[] }, Empty>(
  '/suunto/backfill/batch',
  async (req: Request<Empty, void, { years: string[] }, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const { years } = req.body;
    if (!Array.isArray(years) || years.length === 0) {
      return sendBadRequest(res, 'At least one year is required');
    }

    if (years.length > 10) {
      return sendBadRequest(res, 'Maximum 10 years can be queued at once');
    }

    const currentYear = new Date().getFullYear();
    for (const year of years) {
      if (year !== 'ytd') {
        const yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < MIN_BACKFILL_YEAR || yearNum > currentYear) {
          return sendBadRequest(
            res,
            `Invalid year: ${year}. Must be between ${MIN_BACKFILL_YEAR} and ${currentYear}, or 'ytd'`
          );
        }
      }
    }

    try {
      const existingImportSession = await prisma.importSession.findFirst({
        where: { userId, provider: 'suunto', status: 'running' },
      });

      if (existingImportSession) {
        return res.status(409).json({
          error: 'Import already in progress',
          message: 'A Suunto import is already in progress. Please wait for it to complete before starting another.',
        });
      }

      const existingBackfills = await prisma.backfillRequest.findMany({
        where: {
          userId,
          provider: 'suunto',
          year: { in: years.filter((y) => y !== 'ytd') },
          status: { notIn: ['failed'] },
        },
        select: { year: true, status: true },
      });

      const alreadyBackfilled = new Map(existingBackfills.map((b) => [b.year, b.status]));

      if (years.includes('ytd')) {
        const ytdBackfill = await prisma.backfillRequest.findUnique({
          where: { userId_provider_year: { userId, provider: 'suunto', year: 'ytd' } },
          select: { status: true },
        });
        if (ytdBackfill?.status === 'in_progress') {
          alreadyBackfilled.set('ytd', 'in_progress');
        }
      }

      const yearsToProcess = years.filter((y) => {
        if (y === 'ytd') {
          return alreadyBackfilled.get('ytd') !== 'in_progress';
        }
        return !alreadyBackfilled.has(y);
      });

      if (yearsToProcess.length === 0) {
        return res.status(409).json({
          error: 'All years already backfilled or in progress',
          message: 'All selected years have already been imported or are currently being processed.',
          skipped: years,
        });
      }

      const importSession = await prisma.importSession.create({
        data: {
          userId,
          provider: 'suunto',
          status: 'running',
          startedAt: new Date(),
        },
      });

      logger.info({ importSessionId: importSession.id }, '[Suunto Backfill Batch] Created import session');

      const results: Array<{ year: string; status: string; jobId?: string }> = [];

      for (const year of yearsToProcess) {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'suunto', year } },
          update: { status: 'pending', updatedAt: new Date() },
          create: { userId, provider: 'suunto', year, status: 'pending' },
        });

        const result = await enqueueBackfillJob({
          userId,
          provider: 'suunto',
          year,
        });

        results.push({ year, status: result.status, jobId: result.jobId });
      }

      const skipped = years.filter((y) => !yearsToProcess.includes(y));

      logger.info({ userId, count: results.length }, '[Suunto Backfill Batch] Jobs queued');

      return res.json({
        success: true,
        message: `Queued ${results.length} backfill request(s). Your rides will sync automatically in the background.`,
        queued: results,
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    } catch (error) {
      logError('Suunto Backfill Batch', error);
      return sendInternalError(res, 'Failed to queue backfill requests');
    }
  }
);

r.get<Empty, void, Empty, Empty>(
  '/suunto/backfill/status',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const thirtyDaysAgo = subDays(new Date(), 30);
      const recentRides = await prisma.ride.findMany({
        where: {
          userId,
          suuntoWorkoutId: { not: null },
          startTime: { gte: thirtyDaysAgo },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: {
          id: true,
          suuntoWorkoutId: true,
          startTime: true,
          rideType: true,
          distanceMeters: true,
          createdAt: true,
        },
      });

      const totalRides = await prisma.ride.count({
        where: { userId, suuntoWorkoutId: { not: null } },
      });

      const ytdBackfill = await prisma.backfillRequest.findUnique({
        where: {
          userId_provider_year: { userId, provider: 'suunto', year: 'ytd' },
        },
        select: {
          status: true,
          backfilledUpTo: true,
          ridesFound: true,
          completedAt: true,
        },
      });

      return res.json({
        success: true,
        recentRides,
        totalRides,
        ytdBackfill,
        message: `Found ${recentRides.length} recent Suunto rides (last 30 days), ${totalRides} total`,
      });
    } catch (error) {
      logError('Suunto Backfill Status', error);
      return sendInternalError(res, 'Failed to fetch backfill status');
    }
  }
);

// Admin-gated: bulk-deletes every Suunto ride for the caller. The "testing"
// path component does not provide any access control on its own; the UI hides
// the button behind isAdmin, but the backend must enforce the same boundary
// to prevent accidental or malicious wipes (e.g., a frontend bug or a
// non-admin discovering the route).
r.delete<Empty, void, Empty>(
  '/suunto/testing/delete-imported-rides',
  requireAdmin,
  async (req: Request, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const rides = await prisma.ride.findMany({
        where: { userId, suuntoWorkoutId: { not: null } },
        select: { id: true, durationSeconds: true, bikeId: true },
      });

      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: 'No Suunto rides to delete',
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
          await decrementBikeComponentHours(tx, {
            userId,
            bikeId,
            hoursDelta: hours,
          });
        }

        await tx.ride.deleteMany({
          where: { userId, suuntoWorkoutId: { not: null } },
        });

        await tx.backfillRequest.deleteMany({
          where: { userId, provider: 'suunto' },
        });
      });

      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size,
      });
    } catch (error) {
      logError('Suunto Delete Rides', error);
      return sendInternalError(res, 'Failed to delete Suunto rides');
    }
  }
);

export default r;
