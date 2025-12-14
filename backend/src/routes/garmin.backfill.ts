import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidGarminToken } from '../lib/garmin-token.ts';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma.ts';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Fetch historical activities from Garmin for a given time period
 * Returns activities that need bike assignment
 */
r.get<Empty, void, Empty, { days?: string }>(
  '/garmin/backfill/fetch',
  async (req: Request<Empty, void, Empty, { days?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const days = parseInt(req.query.days || '30', 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Days must be between 1 and 365' });
      }

      // Get valid OAuth token (auto-refreshes if expired)
      const accessToken = await getValidGarminToken(userId);

      if (!accessToken) {
        return res.status(400).json({ error: 'Garmin not connected or token expired. Please reconnect your Garmin account.' });
      }

      // Calculate date range
      const endDate = new Date();
      const startDate = subDays(endDate, days);

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
          } else {
            const text = await backfillRes.text();
            console.error(`[Garmin Backfill] Failed to trigger backfill chunk: ${backfillRes.status} ${text}`);
            errors.push(`Failed for period ${currentStartDate.toISOString().split('T')[0]}: ${backfillRes.status}`);
          }
        } catch (error) {
          console.error(`[Garmin Backfill] Error triggering backfill chunk:`, error);
          errors.push(`Error for period ${currentStartDate.toISOString().split('T')[0]}`);
        }

        // Move to next chunk
        currentStartDate = new Date(actualChunkEndDate);
        currentStartDate.setDate(currentStartDate.getDate() + 1);
      }

      console.log(`[Garmin Backfill] Triggered ${totalChunks} backfill request(s)`);

      // Check if all requests were duplicates (backfill already in progress)
      const duplicateErrors = errors.filter(e => e.includes('Duplicate request'));
      const allDuplicates = duplicateErrors.length === errors.length && errors.length > 0;

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
        message: `Backfill triggered for ${days} days. Your rides will sync automatically via webhooks.`,
        chunksRequested: totalChunks,
        warnings: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error('[Garmin Backfill] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch activities' });
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
      return res.status(401).json({ error: 'Not authenticated' });
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
        return res.status(404).json({ error: 'Garmin account not connected' });
      }

      return res.json({
        garminUserId: userAccount.providerUserId,
        message: 'Use this ID in the Garmin Developer Dashboard Backfill tool',
      });
    } catch (error) {
      console.error('[Garmin User ID] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch Garmin user ID' });
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
      return res.status(401).json({ error: 'Not authenticated' });
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
      console.error('[Garmin Backfill Status] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch backfill status' });
    }
  }
);

export default r;
