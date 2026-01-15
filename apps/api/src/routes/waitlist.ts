import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { validateEmailFormat } from '../auth/email.utils';
import { normalizeEmail } from '../auth/utils';
import { sendBadRequest, sendError, sendSuccess, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';

const router = express.Router();

/**
 * POST /api/waitlist
 * Add email to beta waitlist
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

    const { email: rawEmail, name } = req.body as {
      email?: string;
      name?: string;
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

    // Check if email already exists as a User
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (existingUser) {
      if (existingUser.role === 'WAITLIST') {
        return sendError(res, 409, 'This email is already on the waitlist', 'ALREADY_ON_WAITLIST');
      }
      return sendError(res, 409, 'An account with this email already exists', 'ACCOUNT_EXISTS');
    }

    // Create User with WAITLIST role
    await prisma.user.create({
      data: {
        email,
        name: trimmedName,
        role: 'WAITLIST',
        // passwordHash is null - will be set on activation
      },
    });

    console.log(`[Waitlist] New signup: ${email}`);

    return sendSuccess(res, undefined, 'Successfully joined the waitlist!', 201);

  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[Waitlist] Error:', errorMessage);

    // Handle duplicate email (race condition fallback)
    if (errorMessage.includes('Unique constraint failed')) {
      return sendError(res, 409, 'This email is already on the waitlist', 'ALREADY_ON_WAITLIST');
    }

    return sendInternalError(res, 'Failed to join waitlist. Please try again.');
  }
});

export default router;
