import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import { activateWaitlistUser, generateTempPassword } from '../services/activation.service';
import { hashPassword } from '../auth/password.utils';
import { sendEmail } from '../services/email.service';
import { getActivationEmailSubject, getActivationEmailHtml } from '../templates/emails';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { sendUnauthorized, sendBadRequest, sendInternalError } from '../lib/api-response';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { logError } from '../lib/logger';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const router = Router();

// All admin routes require ADMIN role
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Returns dashboard stats for admin
 */
router.get('/stats', async (_req, res) => {
  try {
    // Single query with groupBy instead of 3 separate count queries
    const roleCounts = await prisma.user.groupBy({
      by: ['role'],
      _count: { role: true },
    });

    // Convert to a lookup map
    const countByRole = new Map(
      roleCounts.map((r) => [r.role, r._count.role])
    );

    // Calculate stats from the grouped counts
    const activeUserCount =
      (countByRole.get('FREE') ?? 0) +
      (countByRole.get('PRO') ?? 0) +
      (countByRole.get('ADMIN') ?? 0);
    const waitlistCount = countByRole.get('WAITLIST') ?? 0;
    const proCount = countByRole.get('PRO') ?? 0;

    res.json({
      users: activeUserCount,
      waitlist: waitlistCount,
      pro: proCount,
    });
  } catch (error) {
    logError('Admin stats', error);
    return sendInternalError(res, 'Failed to fetch stats');
  }
});

/**
 * GET /api/admin/waitlist
 * Returns paginated WAITLIST users
 */
router.get('/waitlist', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'WAITLIST' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where: { role: 'WAITLIST' } }),
    ]);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Admin waitlist', error);
    return sendInternalError(res, 'Failed to fetch waitlist');
  }
});

/**
 * POST /api/admin/activate/:userId
 * Activate a WAITLIST user -> FREE with temp password
 */
router.post('/activate/:userId', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    const { userId } = req.params;

    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Validate userId parameter
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return sendBadRequest(res, 'Invalid userId');
    }

    const trimmedUserId = userId.trim();

    // Rate limit to prevent email flooding
    const rateLimit = await checkAdminRateLimit('activation', trimmedUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Too many activation attempts for this user',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const result = await activateWaitlistUser({ userId: trimmedUserId, adminUserId });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate user';
    console.error('Admin activate error:', message);
    return sendBadRequest(res, message);
  }
});

/**
 * POST /api/admin/users
 * Create a new user with optional activation email
 */
router.post('/users', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Rate limit to prevent accidental spam
    const rateLimit = await checkAdminRateLimit('createUser', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Too many user creation attempts',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { email, name, role = 'FREE', sendActivationEmail = false } = req.body;

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return sendBadRequest(res, 'Valid email is required');
    }

    // Validate role
    const validRoles = ['FREE', 'PRO', 'ADMIN'];
    if (!validRoles.includes(role)) {
      return sendBadRequest(res, `Role must be one of: ${validRoles.join(', ')}`);
    }

    // Check for existing user
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingUser) {
      return sendBadRequest(res, 'User with this email already exists');
    }

    // Generate temp password if sending activation email
    let tempPassword: string | null = null;
    let passwordHash: string | null = null;
    if (sendActivationEmail) {
      tempPassword = generateTempPassword();
      passwordHash = await hashPassword(tempPassword);
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        role,
        passwordHash,
        mustChangePassword: sendActivationEmail,
        activatedAt: new Date(),
        activatedBy: adminUserId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // Send activation email if requested
    let emailSent = false;
    if (sendActivationEmail && tempPassword) {
      try {
        const unsubscribeToken = generateUnsubscribeToken(user.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

        await sendEmail({
          to: user.email,
          subject: getActivationEmailSubject(),
          html: getActivationEmailHtml({
            name: user.name || undefined,
            email: user.email,
            tempPassword,
            loginUrl: `${FRONTEND_URL}/login`,
            unsubscribeUrl,
          }),
        });
        emailSent = true;
        console.log(`[Admin] User ${user.email} created and activated by ${adminUserId}`);
      } catch (emailErr) {
        console.error(`[Admin] Failed to send activation email for ${user.email}:`, emailErr);
      }
    } else {
      console.log(`[Admin] User ${user.email} created (no email) by ${adminUserId}`);
    }

    res.json({
      success: true,
      user,
      emailQueued: emailSent,
      // Only return temp password if email failed but was requested
      ...(sendActivationEmail && !emailSent && tempPassword ? { tempPassword } : {}),
    });
  } catch (error) {
    logError('Admin create user', error);
    return sendInternalError(res, 'Failed to create user');
  }
});

/**
 * POST /api/admin/users/:userId/demote
 * Demote a user back to WAITLIST role (for testing)
 */
router.post('/users/:userId/demote', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    const { userId } = req.params;

    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Rate limit to prevent accidental spam
    const rateLimit = await checkAdminRateLimit('demoteUser', userId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Too many demotion attempts for this user',
        retryAfter: rateLimit.retryAfter,
      });
    }

    // Prevent self-demotion
    if (userId === adminUserId) {
      return sendBadRequest(res, 'Cannot demote your own account');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return sendBadRequest(res, 'User not found');
    }

    if (user.role === 'WAITLIST') {
      return sendBadRequest(res, 'User is already on waitlist');
    }

    // Demote user to WAITLIST and clear activation fields
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'WAITLIST',
        activatedAt: null,
        activatedBy: null,
        mustChangePassword: false,
        passwordHash: null,
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    console.log(`[Admin] User ${user.email} demoted to WAITLIST by ${adminUserId}`);

    res.json({ success: true, user: updated });
  } catch (error) {
    logError('Admin demote user', error);
    return sendInternalError(res, 'Failed to demote user');
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Delete a user
 */
router.delete('/users/:userId', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    const { userId } = req.params;

    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Prevent self-deletion
    if (userId === adminUserId) {
      return sendBadRequest(res, 'Cannot delete your own account');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return sendBadRequest(res, 'User not found');
    }

    // Delete user (cascades to rides, bikes, etc.)
    await prisma.user.delete({
      where: { id: userId },
    });

    console.log(`[Admin] User ${user.email} deleted by ${adminUserId}`);

    res.json({ success: true, deletedUserId: userId });
  } catch (error) {
    logError('Admin delete user', error);
    return sendInternalError(res, 'Failed to delete user');
  }
});

/**
 * DELETE /api/admin/waitlist/:userId
 * Delete a waitlist entry
 */
router.delete('/waitlist/:userId', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    const { userId } = req.params;

    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Verify user exists and is WAITLIST
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return sendBadRequest(res, 'User not found');
    }

    if (user.role !== 'WAITLIST') {
      return sendBadRequest(res, 'User is not in waitlist');
    }

    // Delete user
    await prisma.user.delete({
      where: { id: userId },
    });

    console.log(`[Admin] Waitlist entry ${user.email} deleted by ${adminUserId}`);

    res.json({ success: true, deletedUserId: userId });
  } catch (error) {
    logError('Admin delete waitlist', error);
    return sendInternalError(res, 'Failed to delete waitlist entry');
  }
});

/**
 * GET /api/admin/users
 * Returns paginated active users (FREE, PRO, ADMIN roles)
 */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { role: { in: ['FREE', 'PRO', 'ADMIN'] } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          activatedAt: true,
        },
      }),
      prisma.user.count({ where: { role: { in: ['FREE', 'PRO', 'ADMIN'] } } }),
    ]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Admin users', error);
    return sendInternalError(res, 'Failed to fetch users');
  }
});

/**
 * GET /api/admin/waitlist/export
 * Downloads waitlist as CSV
 */
router.get('/waitlist/export', async (_req, res) => {
  try {
    // Query User table with WAITLIST role (new data model)
    const entries = await prisma.user.findMany({
      where: { role: 'WAITLIST' },
      orderBy: { createdAt: 'desc' },
      select: {
        email: true,
        name: true,
        createdAt: true,
      },
    });

    // Build CSV
    const headers = ['Email', 'Name', 'Signed Up'];
    const rows = entries.map((entry) => [
      entry.email,
      entry.name || '',
      entry.createdAt.toISOString(),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    const filename = `waitlist-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logError('Admin export', error);
    return sendInternalError(res, 'Failed to export waitlist');
  }
});

export default router;
