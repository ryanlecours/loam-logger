import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendUnauthorized, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { logError } from '../lib/logger';
import { captureServerEvent } from '../lib/posthog';
import { getEffectiveTier } from '../auth/tier-access';
import { buildMaintenanceCsv } from '../lib/maintenance-export';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * GET /api/export/maintenance.csv
 *
 * The signed-in rider's whole maintenance history as a CSV download. Cookie or
 * Bearer auth through sessionMiddleware; GET, so no CSRF token is involved.
 * Free for every tier: a rider can always take their own record with them.
 */
r.get<Empty, void, Empty, Empty>(
  '/export/maintenance.csv',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const rateLimit = await checkAuthRateLimit('maintenance-export', userId);
      if (!rateLimit.allowed) {
        return sendTooManyRequests(res, 'Too many exports. Please try again later.', rateLimit.retryAfter);
      }

      const [user, result] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { subscriptionTier: true, isFoundingRider: true, role: true },
        }),
        buildMaintenanceCsv(prisma, userId),
      ]);

      captureServerEvent(userId, 'maintenance_exported', {
        format: 'csv',
        row_count: result.rowCount,
        bike_count: result.bikeCount,
        tier: user ? getEffectiveTier(user) : null,
      });

      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="loam-logger-maintenance-${date}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(result.csv);
    } catch (error) {
      logError('Maintenance export', error);
      return sendInternalError(res, 'Failed to export maintenance history');
    }
  }
);

export default r;
