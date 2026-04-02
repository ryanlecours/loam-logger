import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { validateEmailFormat } from '../auth/email.utils';
import { normalizeEmail } from '../auth/utils';
import { sendBadRequest, sendError, sendSuccess, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { config } from '../config/env';
import { validatePassword, hashPassword } from '../auth/password.utils';
import { setSessionCookie } from '../auth/session';
import { setCsrfCookie } from '../auth/csrf';
import { createNewUser, verifyEmailAvailable } from '../services/signup.service';

const router = express.Router();

/**
 * GET /api/config
 * Public app configuration (e.g., whether waitlist is active)
 */
router.get('/config', (_req, res) => {
  res.json({ waitlistEnabled: !config.bypassWaitlistFlow });
});

/**
 * POST /api/waitlist
 * Add email to beta waitlist, or register directly if waitlist is bypassed.
 * Public endpoint - no authentication required
 */
router.post('/waitlist', express.json(), async (req: Request, res) => {
  try {
    // Rate limit by IP to prevent automated spam signups
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = await checkAuthRateLimit('signup', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many signup attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail, name, ref, password } = req.body as {
      email?: string;
      name?: string;
      ref?: string;
      password?: string;
    };

    // Validate email
    if (!rawEmail) {
      return sendBadRequest(res, 'Email is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email || !validateEmailFormat(email)) {
      return sendBadRequest(res, 'Invalid email format');
    }

    // Optional name validation
    const trimmedName = name?.trim() || null;
    if (trimmedName && trimmedName.length > 255) {
      return sendBadRequest(res, 'Name is too long');
    }

    // Check if email already exists
    const check = await verifyEmailAvailable(email);
    if (!check.available) {
      if (check.role === 'WAITLIST') {
        return sendError(res, 409, 'This email is already on the waitlist', 'ALREADY_ON_WAITLIST');
      }
      return sendError(res, 409, 'An account with this email already exists', 'ACCOUNT_EXISTS');
    }
    const verifiedEmail = check.email;

    if (config.bypassWaitlistFlow) {
      if (!password) {
        return sendBadRequest(res, 'Password is required');
      }
      if (!trimmedName) {
        return sendBadRequest(res, 'Name is required');
      }
      const validation = validatePassword(password);
      if (!validation.isValid) {
        return sendBadRequest(res, validation.error || 'Password does not meet requirements');
      }

      const passwordHash = await hashPassword(password);
      const { user } = await createNewUser({ email: verifiedEmail, name: trimmedName, passwordHash, ref });

      setSessionCookie(res, { uid: user.id, email: user.email, authAt: Date.now() });
      const csrfToken = setCsrfCookie(res);

      return res.status(201).json({ ok: true, waitlist: false, csrfToken });
    }

    // Waitlist flow
    await createNewUser({ email: verifiedEmail, name: trimmedName, passwordHash: null, ref });

    return sendSuccess(res, undefined, 'Successfully joined the waitlist!', 201);

  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error({ error: errorMessage }, '[Waitlist] Signup error');

    if (errorMessage.includes('Unique constraint failed')) {
      return sendError(res, 409, 'This email is already on the waitlist', 'ALREADY_ON_WAITLIST');
    }

    return sendInternalError(res, 'Failed to join waitlist. Please try again.');
  }
});

/**
 * GET /api/waitlist/stats
 * Public stats for the landing page (cached for 60s)
 */
const STATS_TTL_MS = 60_000;
let statsCachePromise: Promise<{ signupCount: number; ridesTracked: number }> | null = null;
let statsCacheExpiresAt = 0;

async function getPublicStats() {
  if (statsCachePromise && Date.now() < statsCacheExpiresAt) return statsCachePromise;

  statsCacheExpiresAt = Date.now() + STATS_TTL_MS;
  statsCachePromise = (async () => {
    const [waitlistCount, activeUserCount, ridesTracked] = await Promise.all([
      prisma.user.count({ where: { role: 'WAITLIST' } }),
      prisma.user.count({ where: { role: { in: ['FREE', 'PRO', 'ADMIN'] } } }),
      prisma.ride.count(),
    ]);
    return { signupCount: waitlistCount + activeUserCount, ridesTracked };
  })().catch((e) => {
    statsCacheExpiresAt = 0;
    statsCachePromise = null;
    throw e;
  });

  return statsCachePromise;
}

router.get('/waitlist/stats', async (req: Request, res) => {
  try {
    const rateLimit = await checkAuthRateLimit('public-stats', req.ip ?? 'unknown');
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many requests. Please try again later.', rateLimit.retryAfter);
    }

    const data = await getPublicStats();
    return sendSuccess(res, data);
  } catch (e) {
    console.error('[Waitlist Stats] Error:', e instanceof Error ? e.message : String(e));
    return sendInternalError(res, 'Failed to fetch stats.');
  }
});

export default router;
