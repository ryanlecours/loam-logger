import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { validateEmailFormat } from '../auth/email.utils';
import { normalizeEmail } from '../auth/utils';
import { sendBadRequest, sendError, sendSuccess, sendInternalError } from '../lib/api-response';
import crypto from 'crypto';

const router = express.Router();

// Secret for salting IP hashes to prevent rainbow table attacks
const IP_HASH_SECRET = process.env.IP_HASH_SECRET || 'loam-waitlist-ip-salt';

/**
 * POST /api/waitlist
 * Add email to beta waitlist
 * Public endpoint - no authentication required
 */
router.post('/waitlist', express.json(), async (req: Request, res) => {
  try {
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

    // Extract metadata
    const rawReferrer = req.headers.referer || req.headers.referrer || null;
    const referrer = typeof rawReferrer === 'string'
      ? rawReferrer.substring(0, 500)
      : null;

    const rawUserAgent = req.headers['user-agent'] || null;
    const userAgent = typeof rawUserAgent === 'string'
      ? rawUserAgent.substring(0, 500)
      : null;

    // Hash IP for privacy (not storing raw IP)
    // Salt prevents rainbow table attacks on common IP addresses
    const rawIp = req.ip || null;
    const ipAddress = rawIp
      ? crypto.createHash('sha256').update(rawIp + IP_HASH_SECRET).digest('hex').substring(0, 32)
      : null;

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

    // Create User with WAITLIST role and BetaWaitlist record atomically
    await prisma.$transaction([
      prisma.user.create({
        data: {
          email,
          name: trimmedName,
          role: 'WAITLIST',
          // passwordHash is null - will be set on activation
        },
      }),
      // Also keep a record in BetaWaitlist for historical/analytics purposes
      prisma.betaWaitlist.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: trimmedName,
          referrer,
          userAgent,
          ipAddress,
        },
      }),
    ]);

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
