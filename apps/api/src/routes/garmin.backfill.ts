import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidGarminToken } from '../lib/garmin-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendNotFound, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';

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
      // Get valid OAuth token (auto-refreshes if expired)
      const accessToken = await getValidGarminToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'Garmin not connected or token expired. Please reconnect your Garmin account.');
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

          if (existingYtd?.backfilledUpTo && existingYtd.status !== 'failed') {
            // Start from where we left off (add 1 second to avoid overlap)
            startDate = new Date(existingYtd.backfilledUpTo.getTime() + 1000);
            periodDescription = `new activities since ${existingYtd.backfilledUpTo.toLocaleDateString()}`;
          } else {
            startDate = new Date(currentYear, 0, 1); // Jan 1 00:00:00
            periodDescription = `year to date (${currentYear})`;
          }
          endDate = new Date(); // Now
        } else {
          const year = parseInt(yearParam, 10);
          if (isNaN(year) || year < 2000 || year > currentYear) {
            return sendBadRequest(res, `Year must be between 2000 and ${currentYear}, or 'ytd'`);
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

      console.log(`[Garmin Backfill] Triggering backfill for ${startDateStr} to ${endDateStr}`);

      // Garmin Wellness API: Use the async backfill endpoint
      // This triggers Garmin to send activities via webhooks
      const API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';

      // Wellness API: Trigger backfill in 30-day chunks (API limit)
      const CHUNK_DAYS = 30;
      let currentStartDate = new Date(startDate);
      let totalChunks = 0;
      const errors: string[] = [];

      console.log(`[Garmin Backfill] Triggering async backfill requests`);

      while (currentStartDate < endDate) {
        // Calculate chunk end date (30 days from chunk start, or endDate if sooner)
        const chunkEndDate = new Date(currentStartDate);
        chunkEndDate.setDate(chunkEndDate.getDate() + CHUNK_DAYS);
        const actualChunkEndDate = chunkEndDate > endDate ? endDate : chunkEndDate;

        const chunkStartSeconds = Math.floor(currentStartDate.getTime() / 1000);
        const chunkEndSeconds = Math.floor(actualChunkEndDate.getTime() / 1000);

        console.log(`[Garmin Backfill] Triggering backfill chunk: ${currentStartDate.toISOString()} to ${actualChunkEndDate.toISOString()}`);

        const url = `${API_BASE}/rest/backfill/activities?summaryStartTimeInSeconds=${chunkStartSeconds}&summaryEndTimeInSeconds=${chunkEndSeconds}`;

        try {
          const backfillRes = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json',
            },
          });

          if (backfillRes.status === 202) {
            // 202 Accepted - backfill request accepted
            console.log(`[Garmin Backfill] Backfill request accepted for chunk ${totalChunks + 1}`);
            totalChunks++;
          } else if (backfillRes.status === 409) {
            // 409 Conflict - duplicate request (already requested this time period)
            console.log(`[Garmin Backfill] Backfill already in progress for this time period`);
            errors.push(`Duplicate request for period ${currentStartDate.toISOString().split('T')[0]}`);
          } else if (backfillRes.status === 400) {
            const text = await backfillRes.text();
            const minStartDate = extractMinStartDate(text);
            if (minStartDate && minStartDate > currentStartDate) {
              console.warn(
                `[Garmin Backfill] Chunk ${currentStartDate.toISOString()} rejected. Adjusting start to Garmin min ${minStartDate.toISOString()}`
              );
              errors.push(
                `Adjusted start date to ${minStartDate.toISOString()} due to Garmin min start restriction`
              );
              const alignedMinStart = new Date(Math.ceil(minStartDate.getTime() / 1000) * 1000);
              currentStartDate = alignedMinStart;
              continue;
            }
            console.error(`[Garmin Backfill] Failed to trigger backfill chunk: ${backfillRes.status} ${text}`);
            errors.push(
              `Failed for period ${currentStartDate.toISOString().split('T')[0]}: ${backfillRes.status}`
            );
          } else {
            const text = await backfillRes.text();
            console.error(`[Garmin Backfill] Failed to trigger backfill chunk: ${backfillRes.status} ${text}`);
            errors.push(`Failed for period ${currentStartDate.toISOString().split('T')[0]}: ${backfillRes.status}`);
          }
        } catch (error) {
          logError('Garmin Backfill chunk', error);
          errors.push(`Error for period ${currentStartDate.toISOString().split('T')[0]}`);
        }

        // Move to next chunk - start exactly where the previous chunk ended
        // This ensures no gaps between chunks (Garmin deduplicates by activity ID)
        currentStartDate = new Date(actualChunkEndDate);
      }

      console.log(`[Garmin Backfill] Triggered ${totalChunks} backfill request(s)`);

      // Check if all requests were duplicates (backfill already in progress)
      const duplicateErrors = errors.filter(e => e.includes('Duplicate request'));
      const allDuplicates = duplicateErrors.length === errors.length && errors.length > 0;

      // Track backfill request in database (only for year-based requests)
      const yearKey = req.query.year || null;
      if (yearKey) {
        try {
          // For YTD, store the end timestamp so we can do incremental backfills later
          const backfilledUpToValue = yearKey === 'ytd' ? endDate : null;

          if (totalChunks === 0 && allDuplicates) {
            // Already in progress - update status
            await prisma.backfillRequest.upsert({
              where: { userId_provider_year: { userId, provider: 'garmin', year: yearKey } },
              update: { status: 'in_progress', updatedAt: new Date(), backfilledUpTo: backfilledUpToValue },
              create: { userId, provider: 'garmin', year: yearKey, status: 'in_progress', backfilledUpTo: backfilledUpToValue },
            });
          } else if (totalChunks === 0) {
            // Failed - don't update backfilledUpTo
            await prisma.backfillRequest.upsert({
              where: { userId_provider_year: { userId, provider: 'garmin', year: yearKey } },
              update: { status: 'failed', updatedAt: new Date() },
              create: { userId, provider: 'garmin', year: yearKey, status: 'failed' },
            });
          } else {
            // Success - mark as in_progress (Garmin is async via webhooks)
            await prisma.backfillRequest.upsert({
              where: { userId_provider_year: { userId, provider: 'garmin', year: yearKey } },
              update: { status: 'in_progress', updatedAt: new Date(), backfilledUpTo: backfilledUpToValue },
              create: { userId, provider: 'garmin', year: yearKey, status: 'in_progress', backfilledUpTo: backfilledUpToValue },
            });
          }
        } catch (dbError) {
          logError('Garmin Backfill DB tracking', dbError);
          // Don't fail the request if tracking fails
        }
      }

      if (totalChunks === 0 && allDuplicates) {
        return res.status(409).json({
          error: 'Backfill already in progress',
          message: `A backfill for this time period is already in progress. Your rides will sync automatically when it completes.`,
          details: errors,
        });
      }

      if (totalChunks === 0) {
        return res.status(400).json({
          error: 'Failed to trigger any backfill requests',
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
          distanceMiles: true,
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

function extractMinStartDate(errorText: string): Date | null {
  try {
    const parsed = JSON.parse(errorText);
    const message =
      typeof parsed?.errorMessage === 'string' ? parsed.errorMessage : String(parsed ?? '');
    const match = message.match(/min start time of ([0-9T:.-]+Z)/i);
    if (match && match[1]) {
      const dt = new Date(match[1]);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
  } catch {
    // ignore JSON parse errors and fall through
  }
  return null;
}
