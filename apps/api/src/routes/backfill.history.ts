import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendUnauthorized, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Get backfill request history for the current user
 * Returns all backfill requests sorted by most recent first
 */
r.get<Empty, void, Empty, { provider?: string }>(
  '/backfill/history',
  async (req: Request<Empty, void, Empty, { provider?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const where: { userId: string; provider?: 'strava' | 'garmin' } = { userId };

      const validProviders = ['strava', 'garmin'] as const;
      const providerParam = req.query.provider;
      if (typeof providerParam === 'string' && validProviders.includes(providerParam as 'strava' | 'garmin')) {
        where.provider = providerParam as 'strava' | 'garmin';
      }

      const requests = await prisma.backfillRequest.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          year: true,
          status: true,
          ridesFound: true,
          backfilledUpTo: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
        },
      });

      return res.json({
        success: true,
        requests,
      });
    } catch (error) {
      logError('Backfill History', error);
      return sendInternalError(res, 'Failed to fetch backfill history');
    }
  }
);

export default r;
