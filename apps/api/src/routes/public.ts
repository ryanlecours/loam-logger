import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';

const router = express.Router();

/**
 * GET /api/public/stats
 * Public stats for the marketing landing page (cached for 60s).
 * Returns the total count of active users for social proof.
 */
const STATS_TTL_MS = 60_000;
let statsCachePromise: Promise<{ userCount: number; ridesTracked: number }> | null = null;
let statsCacheExpiresAt = 0;

async function getPublicStats() {
  if (statsCachePromise && Date.now() < statsCacheExpiresAt) return statsCachePromise;

  statsCacheExpiresAt = Date.now() + STATS_TTL_MS;
  statsCachePromise = (async () => {
    const [userCount, ridesTracked] = await Promise.all([
      prisma.user.count({ where: { role: { in: ['FREE', 'PRO', 'ADMIN'] } } }),
      prisma.ride.count(),
    ]);
    return { userCount, ridesTracked };
  })().catch((e) => {
    statsCacheExpiresAt = 0;
    statsCachePromise = null;
    throw e;
  });

  return statsCachePromise;
}

router.get('/public/stats', async (req: Request, res) => {
  try {
    const rateLimit = await checkAuthRateLimit('public-stats', req.ip ?? 'unknown');
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many requests. Please try again later.', rateLimit.retryAfter);
    }

    const data = await getPublicStats();
    return sendSuccess(res, data);
  } catch (e) {
    console.error('[Public Stats] Error:', e instanceof Error ? e.message : String(e));
    return sendInternalError(res, 'Failed to fetch stats.');
  }
});

export default router;
