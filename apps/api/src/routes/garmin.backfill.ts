import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidGarminToken } from '../lib/garmin-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendInternalError } from '../lib/api-response';
import { logError, logger } from '../lib/logger';
import { enqueueBackfillJob } from '../lib/queue/backfill.queue';
import { canBackfillYear } from '../auth/tier-access';
import { triggerGarminBackfillChunks } from '../services/garmin-backfill';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Fetch historical activities from Garmin for a given time period
 * Supports both `year` parameter (ytd or specific year) and `days` parameter (1-365)
 * Returns activities that need bike assignment
 */
r.get<Empty, void, Empty, { days?: string; year?: string }>(
  '/garmin/backfill/fetch',
  async (req: Request<Empty, void, Empty, { days?: string; year?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      // Import depth is tier-gated: free accounts backfill the current year only
      const tierUser = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { subscriptionTier: true, isFoundingRider: true, role: true },
      });
      if (!canBackfillYear(tierUser, req.query.year)) {
        return sendForbidden(
          res,
          'Importing past seasons is a Pro feature. Free accounts can import the current year.',
          'TIER_BACKFILL_RESTRICTED'
        );
      }

      // Get valid OAuth token (auto-refreshes if expired)
      const accessToken = await getValidGarminToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'Garmin not connected or token expired. Please reconnect your Garmin account.');
      }

      // Check for existing running ImportSession - prevent concurrent backfills
      const existingImportSession = await prisma.importSession.findFirst({
        where: { userId, provider: 'garmin', status: 'running' },
      });

      if (existingImportSession) {
        return res.status(409).json({
          error: 'Import already in progress',
          message: 'A Garmin import is already in progress. Please wait for it to complete before starting another.',
        });
      }

      // Calculate date range based on year or days parameter
      let startDate: Date;
      let endDate: Date;
      let periodDescription: string;

      if (req.query.year) {
        const currentYear = new Date().getFullYear();
        const yearParam = req.query.year;

        if (yearParam === 'ytd') {
          // Check for existing YTD backfill to enable incremental fetching
          const existingYtd = await prisma.backfillRequest.findUnique({
            where: { userId_provider_year: { userId, provider: 'garmin', year: 'ytd' } },
          });

          // Block re-triggering if a YTD backfill is already in progress
          if (existingYtd?.status === 'in_progress') {
            return res.status(409).json({
              error: 'Backfill already in progress',
              message: 'A YTD backfill is already in progress. Please wait for it to complete before requesting another.',
            });
          }

          if (existingYtd?.backfilledUpTo && existingYtd.status === 'completed') {
            // Only use incremental logic if the previous backfill fully completed
            // This avoids missing activities if a previous backfill failed mid-way
            startDate = new Date(existingYtd.backfilledUpTo.getTime() + 1000);
            periodDescription = `new activities since ${existingYtd.backfilledUpTo.toLocaleDateString()}`;
          } else {
            startDate = new Date(currentYear, 0, 1); // Jan 1 00:00:00
            periodDescription = `year to date (${currentYear})`;
          }
          endDate = new Date(); // Now
        } else {
          const year = parseInt(yearParam, 10);
          const minYear = currentYear - 4;
          if (isNaN(year) || year < minYear || year > currentYear) {
            return sendBadRequest(res, `Year must be between ${minYear} and ${currentYear}, or 'ytd'`);
          }

          // Check if this specific year has already been backfilled
          const existingBackfill = await prisma.backfillRequest.findUnique({
            where: { userId_provider_year: { userId, provider: 'garmin', year: yearParam } },
          });

          if (existingBackfill && existingBackfill.status !== 'failed') {
            return res.status(409).json({
              error: 'Year already backfilled',
              message: `${yearParam} has already been imported. Garmin data for this year is complete.`,
            });
          }

          startDate = new Date(year, 0, 1); // Jan 1 00:00:00
          endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31 23:59:59
          periodDescription = `year ${year}`;
        }
      } else {
        // Existing days-based logic for backwards compatibility
        const days = parseInt(req.query.days || '30', 10);
        if (isNaN(days) || days < 1 || days > 365) {
          return sendBadRequest(res, 'Days must be between 1 and 365');
        }
        endDate = new Date();
        startDate = subDays(endDate, days);
        periodDescription = `${days} days`;
      }

      const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDateStr = endDate.toISOString().split('T')[0];

      logger.info({ startDate: startDateStr, endDate: endDateStr }, 'Triggering Garmin backfill');

      // Create ImportSession to track this backfill's rides
      const importSession = await prisma.importSession.create({
        data: {
          userId,
          provider: 'garmin',
          status: 'running',
          startedAt: new Date(),
        },
      });

      logger.info({ importSessionId: importSession.id }, 'Created import session for Garmin backfill');

      // Garmin Wellness API: trigger the async backfill in 30-day chunks.
      // Garmin re-delivers the activities via webhooks (activities-ping →
      // processGarminCallback). This shared helper owns the chunk loop and the
      // 202/409/400 handling; see services/garmin-backfill.ts.
      logger.debug('Triggering async Garmin backfill requests');
      const { totalChunks, errors, allDuplicates } = await triggerGarminBackfillChunks({
        accessToken,
        startDate,
        endDate,
      });

      logger.info({ totalChunks }, 'Garmin backfill requests triggered');

      // Track backfill request in database (only for year-based requests)
      // Uses atomic conditional update to prevent race condition with webhook completion
      const yearKey = req.query.year || null;
      if (yearKey) {
        try {
          // For YTD, store the end timestamp so we can do incremental backfills later
          const backfilledUpToValue = yearKey === 'ytd' ? endDate : null;

          // Determine target status based on results
          const targetStatus = totalChunks === 0 && !allDuplicates ? 'failed' : 'in_progress';
          const updateData =
            targetStatus === 'failed'
              ? { status: 'failed' as const, updatedAt: new Date() }
              : { status: 'in_progress' as const, updatedAt: new Date(), backfilledUpTo: backfilledUpToValue };

          // First ensure record exists (upsert with no-op update for existing records)
          await prisma.backfillRequest.upsert({
            where: { userId_provider_year: { userId, provider: 'garmin', year: yearKey } },
            update: {}, // No-op - actual update done atomically below
            create: { userId, provider: 'garmin', year: yearKey, ...updateData },
          });

          // Atomically update ONLY if status is not 'completed' (prevents race condition with webhooks)
          const updated = await prisma.backfillRequest.updateMany({
            where: {
              userId,
              provider: 'garmin',
              year: yearKey,
              status: { not: 'completed' },
            },
            data: updateData,
          });

          if (updated.count === 0) {
            logger.debug({ year: yearKey }, 'Garmin backfill status update skipped - already completed');
          }
        } catch (dbError) {
          logError('Garmin Backfill DB tracking', dbError);
          // Don't fail the request if tracking fails
        }
      }

      if (totalChunks === 0 && allDuplicates) {
        // All chunks returned 409 - backfill was already done for this date range
        // Log warning but return success to client so it shows as completed
        logger.warn(
          { userId, year: req.query.year, periodDescription },
          'Garmin backfill already completed for entire date range'
        );

        // Mark as completed in database if tracking by year
        if (yearKey) {
          try {
            await prisma.backfillRequest.upsert({
              where: { userId_provider_year: { userId, provider: 'garmin', year: yearKey } },
              update: { status: 'completed', updatedAt: new Date() },
              create: { userId, provider: 'garmin', year: yearKey, status: 'completed' },
            });
          } catch (dbError) {
            logError('Garmin Backfill DB tracking (409 completed)', dbError);
          }
        }

        // Mark the import session as completed since no new rides will be coming
        await prisma.importSession.update({
          where: { id: importSession.id },
          data: { status: 'completed', completedAt: new Date(), unassignedRideCount: 0 },
        });

        return res.json({
          success: true,
          alreadyCompleted: true,
          message: `Backfill for ${periodDescription} was already completed. Your rides should already be synced.`,
        });
      }

      if (totalChunks === 0) {
        // Mark import session as completed (no rides will come)
        await prisma.importSession.update({
          where: { id: importSession.id },
          data: { status: 'completed', completedAt: new Date(), unassignedRideCount: 0 },
        });

        return res.status(400).json({
          error: 'Failed to trigger backfill',
          message: 'Unable to request historical data from Garmin. Please try again later or select a different time period.',
          details: errors,
        });
      }

      // Return success - activities will arrive via webhooks
      return res.json({
        success: true,
        message: `Backfill triggered for ${periodDescription}. Your rides will sync automatically via webhooks.`,
        chunksRequested: totalChunks,
        warnings: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      logError('Garmin Backfill', error);
      return sendInternalError(res, 'Failed to fetch activities');
    }
  }
);

/**
 * Queue multiple years for background backfill processing
 * Accepts an array of years and queues them as background jobs
 */
r.post<Empty, void, { years: string[] }, Empty>(
  '/garmin/backfill/batch',
  async (req: Request<Empty, void, { years: string[] }, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const { years } = req.body;
    if (!Array.isArray(years) || years.length === 0) {
      return sendBadRequest(res, 'At least one year is required');
    }

    // Limit to 10 years max to prevent abuse
    if (years.length > 10) {
      return sendBadRequest(res, 'Maximum 10 years can be queued at once');
    }

    // Validate all years upfront (fail fast before any DB queries)
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 4;
    for (const year of years) {
      if (year !== 'ytd') {
        const yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < minYear || yearNum > currentYear) {
          return sendBadRequest(res, `Invalid year: ${year}. Must be between ${minYear} and ${currentYear}, or 'ytd'`);
        }
      }
    }

    try {
      // Check for existing running ImportSession - prevent concurrent backfills
      const existingImportSession = await prisma.importSession.findFirst({
        where: { userId, provider: 'garmin', status: 'running' },
      });

      if (existingImportSession) {
        return res.status(409).json({
          error: 'Import already in progress',
          message: 'A Garmin import is already in progress. Please wait for it to complete before starting another.',
        });
      }

      // Check for already backfilled years (non-YTD only, skip failed ones)
      const existingBackfills = await prisma.backfillRequest.findMany({
        where: {
          userId,
          provider: 'garmin',
          year: { in: years.filter(y => y !== 'ytd') },
          status: { notIn: ['failed'] },
        },
        select: { year: true, status: true },
      });

      const alreadyBackfilled = new Map(existingBackfills.map(b => [b.year, b.status]));

      // Check if YTD is in progress
      if (years.includes('ytd')) {
        const ytdBackfill = await prisma.backfillRequest.findUnique({
          where: { userId_provider_year: { userId, provider: 'garmin', year: 'ytd' } },
          select: { status: true },
        });
        if (ytdBackfill?.status === 'in_progress') {
          alreadyBackfilled.set('ytd', 'in_progress');
        }
      }

      // Filter to years that can be processed
      const yearsToProcess = years.filter(y => {
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

      // Create ImportSession to track this backfill's rides
      const importSession = await prisma.importSession.create({
        data: {
          userId,
          provider: 'garmin',
          status: 'running',
          startedAt: new Date(),
        },
      });

      logger.info({ importSessionId: importSession.id }, 'Created import session for Garmin batch backfill');

      // Create BackfillRequest records and queue jobs
      const results: Array<{ year: string; status: string; jobId?: string }> = [];

      for (const year of yearsToProcess) {
        // Create or update record to pending status
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'garmin', year } },
          update: { status: 'pending', updatedAt: new Date() },
          create: { userId, provider: 'garmin', year, status: 'pending' },
        });

        // If enqueue fails (Redis down, BullMQ error, etc.) the BackfillRequest
        // row already says 'pending' but no worker job exists to process it,
        // leaving it phantom-pending forever. Catch here so we can mark this
        // year failed and continue queuing the rest — partial success is
        // better than silent corruption + a 500.
        try {
          const result = await enqueueBackfillJob({
            userId,
            provider: 'garmin',
            year,
          });
          results.push({ year, status: result.status, jobId: result.jobId });
        } catch (enqueueErr) {
          logError(`Garmin Backfill Batch enqueue ${year}`, enqueueErr);
          await prisma.backfillRequest.updateMany({
            where: { userId, provider: 'garmin', year },
            data: { status: 'failed', updatedAt: new Date() },
          });
          results.push({ year, status: 'failed' });
        }
      }

      const skipped = years.filter(y => !yearsToProcess.includes(y));

      logger.info({ count: results.length, userId }, 'Garmin backfill jobs queued');

      return res.json({
        success: true,
        message: `Queued ${results.length} backfill request(s). Your rides will sync automatically in the background.`,
        queued: results,
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    } catch (error) {
      logError('Garmin Backfill Batch', error);
      return sendInternalError(res, 'Failed to queue backfill requests');
    }
  }
);

/**
 * Get the user's Garmin User ID for use in Garmin Developer Dashboard
 */
r.get<Empty, void, Empty, Empty>(
  '/garmin/backfill/garmin-user-id',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider: 'garmin',
        },
        select: {
          providerUserId: true,
        },
      });

      if (!userAccount) {
        return sendNotFound(res, 'Garmin account not connected');
      }

      return res.json({
        garminUserId: userAccount.providerUserId,
        message: 'Use this ID in the Garmin Developer Dashboard Backfill tool',
      });
    } catch (error) {
      logError('Garmin User ID', error);
      return sendInternalError(res, 'Failed to fetch Garmin user ID');
    }
  }
);

/**
 * Check recent Garmin webhook activity and ride imports
 * Useful for debugging backfill issues
 */
r.get<Empty, void, Empty, Empty>(
  '/garmin/backfill/status',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      // Get recent rides imported from Garmin (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30);
      const recentGarminRides = await prisma.ride.findMany({
        where: {
          userId,
          garminActivityId: { not: null },
          startTime: { gte: thirtyDaysAgo },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: {
          id: true,
          garminActivityId: true,
          startTime: true,
          rideType: true,
          distanceMeters: true,
          createdAt: true,
        },
      });

      // Get total Garmin rides for this user
      const totalGarminRides = await prisma.ride.count({
        where: {
          userId,
          garminActivityId: { not: null },
        },
      });

      return res.json({
        success: true,
        recentRides: recentGarminRides,
        totalGarminRides,
        message: `Found ${recentGarminRides.length} recent Garmin rides (last 30 days), ${totalGarminRides} total`,
      });
    } catch (error) {
      logError('Garmin Backfill Status', error);
      return sendInternalError(res, 'Failed to fetch backfill status');
    }
  }
);

export default r;
