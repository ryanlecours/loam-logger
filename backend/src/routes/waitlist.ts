import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { validateEmailFormat } from '../auth/email.utils';
import { normalizeEmail } from '../auth/utils';
import crypto from 'crypto';

const router = express.Router();

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
      return res.status(400).json({ message: 'Email is required' });
    }

    const email = normalizeEmail(rawEmail);
    if (!email || !validateEmailFormat(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Optional name validation
    const trimmedName = name?.trim() || null;
    if (trimmedName && trimmedName.length > 255) {
      return res.status(400).json({ message: 'Name is too long' });
    }

    // Extract metadata
    const referrer = req.headers.referer || req.headers.referrer || null;
    const userAgent = req.headers['user-agent'] || null;

    // Hash IP for privacy (not storing raw IP)
    const rawIp = req.ip || null;
    const ipAddress = rawIp
      ? crypto.createHash('sha256').update(rawIp).digest('hex').substring(0, 32)
      : null;

    // Insert into database
    await prisma.betaWaitlist.create({
      data: {
        email,
        name: trimmedName,
        referrer: referrer?.substring(0, 500) || null,
        userAgent: userAgent?.substring(0, 500) || null,
        ipAddress,
      },
    });

    console.log(`[Waitlist] New signup: ${email}`);

    return res.status(201).json({
      ok: true,
      message: 'Successfully joined the waitlist!',
    });

  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[Waitlist] Error:', error);

    // Handle duplicate email
    if (error.includes('Unique constraint failed')) {
      return res.status(409).json({
        message: 'This email is already on the waitlist'
      });
    }

    return res.status(500).json({
      message: 'Failed to join waitlist. Please try again.'
    });
  }
});

export default router;
