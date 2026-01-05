import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import { activateWaitlistUser, generateTempPassword } from '../services/activation.service';
import { hashPassword } from '../auth/password.utils';
import { sendEmail, sendEmailWithAudit } from '../services/email.service';
import {
  getActivationEmailSubject,
  getActivationEmailHtml,
  getAnnouncementEmailHtml,
  ANNOUNCEMENT_TEMPLATE_VERSION,
} from '../templates/emails';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { sendUnauthorized, sendBadRequest, sendInternalError } from '../lib/api-response';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { logError } from '../lib/logger';
import { escapeHtml } from '../lib/html';
import type { UserRole } from '@prisma/client';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Validation helpers
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUID_REGEX = /^c[a-z0-9]{24}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;
const MAX_SUBJECT_LENGTH = 200;

/**
 * Validate that a value is a valid database ID (UUID or CUID format).
 * Prevents SQL injection via malformed IDs.
 */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && (UUID_REGEX.test(id) || CUID_REGEX.test(id));
}

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
      (countByRole.get('FOUNDING_RIDERS') ?? 0) +
      (countByRole.get('FREE') ?? 0) +
      (countByRole.get('PRO') ?? 0) +
      (countByRole.get('ADMIN') ?? 0);
    const waitlistCount = countByRole.get('WAITLIST') ?? 0;
    const foundingRidersCount = countByRole.get('FOUNDING_RIDERS') ?? 0;
    const proCount = countByRole.get('PRO') ?? 0;

    res.json({
      users: activeUserCount,
      waitlist: waitlistCount,
      foundingRiders: foundingRidersCount,
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
          emailUnsubscribed: true,
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

    // Validate email with proper regex and length check
    if (
      !email ||
      typeof email !== 'string' ||
      email.length > MAX_EMAIL_LENGTH ||
      !EMAIL_REGEX.test(email)
    ) {
      return sendBadRequest(res, 'Valid email is required');
    }

    // Validate role
    const validRoles = ['FOUNDING_RIDERS', 'FREE', 'PRO', 'ADMIN'];
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
 * POST /api/admin/promote/:userId
 * Promote a WAITLIST user to FOUNDING_RIDERS
 */
router.post('/promote/:userId', async (req, res) => {
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
      return sendBadRequest(res, 'User is not on waitlist');
    }

    // Promote to FOUNDING_RIDERS
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'FOUNDING_RIDERS',
        activatedAt: new Date(),
        activatedBy: adminUserId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    console.log(`[Admin] User ${user.email} promoted to FOUNDING_RIDERS by ${adminUserId}`);

    res.json({ success: true, user: updated });
  } catch (error) {
    logError('Admin promote user', error);
    return sendInternalError(res, 'Failed to promote user');
  }
});

/**
 * POST /api/admin/promote/bulk
 * Promote multiple WAITLIST users to FOUNDING_RIDERS
 */
router.post('/promote/bulk', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    const { userIds } = req.body;

    // Validate input
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequest(res, 'At least one user ID is required');
    }

    if (userIds.length > 100) {
      return sendBadRequest(res, 'Cannot promote more than 100 users at once');
    }

    // Validate all IDs are proper format (prevents injection)
    const invalidIds = userIds.filter((id) => !isValidId(id));
    if (invalidIds.length > 0) {
      return sendBadRequest(res, 'Invalid user ID format');
    }

    // Use transaction to ensure atomicity of the check + update
    const result = await prisma.$transaction(async (tx) => {
      // Verify all users exist and are WAITLIST
      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, role: true },
      });

      const nonWaitlistUsers = users.filter((u) => u.role !== 'WAITLIST');
      if (nonWaitlistUsers.length > 0) {
        throw new Error(`Cannot promote ${nonWaitlistUsers.length} user(s) not on waitlist`);
      }

      const validUserIds = users.map((u) => u.id);

      // Promote all valid users
      await tx.user.updateMany({
        where: { id: { in: validUserIds } },
        data: {
          role: 'FOUNDING_RIDERS',
          activatedAt: new Date(),
          activatedBy: adminUserId,
        },
      });

      return {
        promotedCount: validUserIds.length,
        promotedEmails: users.map((u) => u.email),
      };
    });

    console.log(
      `[Admin] ${result.promotedCount} users promoted to FOUNDING_RIDERS by ${adminUserId}`
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    // Handle transaction validation errors separately
    if (error instanceof Error && error.message.includes('Cannot promote')) {
      return sendBadRequest(res, error.message);
    }
    logError('Admin bulk promote', error);
    return sendInternalError(res, 'Failed to promote users');
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
        where: { role: { in: ['FOUNDING_RIDERS', 'FREE', 'PRO', 'ADMIN'] } },
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
          emailUnsubscribed: true,
        },
      }),
      prisma.user.count({ where: { role: { in: ['FOUNDING_RIDERS', 'FREE', 'PRO', 'ADMIN'] } } }),
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

// ============================================================================
// Email Management Endpoints
// ============================================================================

const VALID_EMAIL_ROLES: UserRole[] = ['WAITLIST', 'FOUNDING_RIDERS'];

/**
 * GET /api/admin/email/recipients
 * List users by role with email/name/unsubscribed status for checkbox selection
 */
router.get('/email/recipients', async (req, res) => {
  try {
    const { role } = req.query;

    if (!role || !VALID_EMAIL_ROLES.includes(role as UserRole)) {
      return sendBadRequest(res, `Role must be one of: ${VALID_EMAIL_ROLES.join(', ')}`);
    }

    const users = await prisma.user.findMany({
      where: { role: role as UserRole },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        emailUnsubscribed: true,
      },
    });

    res.json({ users });
  } catch (error) {
    logError('Admin email recipients', error);
    return sendInternalError(res, 'Failed to fetch recipients');
  }
});

/**
 * POST /api/admin/email/preview
 * Preview rendered email template
 */
router.post('/email/preview', async (req, res) => {
  try {
    const { templateType, subject, messageHtml } = req.body;

    if (!templateType || !['announcement', 'custom'].includes(templateType)) {
      return sendBadRequest(res, 'Invalid template type');
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return sendBadRequest(res, 'Subject is required');
    }

    if (!messageHtml || typeof messageHtml !== 'string') {
      return sendBadRequest(res, 'Message body is required');
    }

    // Sanitize and convert newlines to <br> for HTML display
    const sanitizedMessage = escapeHtml(messageHtml).replace(/\n/g, '<br>');

    const html = getAnnouncementEmailHtml({
      name: 'Preview User',
      subject: subject.trim(),
      messageHtml: sanitizedMessage,
      unsubscribeUrl: '#preview-unsubscribe',
    });

    res.json({
      subject: subject.trim(),
      html,
    });
  } catch (error) {
    logError('Admin email preview', error);
    return sendInternalError(res, 'Failed to generate preview');
  }
});

/**
 * POST /api/admin/email/send
 * Send bulk email to selected user IDs with audit logging
 */
router.post('/email/send', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Rate limit bulk emails (1 per minute per admin)
    const rateLimit = await checkAdminRateLimit('bulkEmail', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Please wait before sending another bulk email',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { userIds, templateType, subject, messageHtml } = req.body;

    // Validate inputs
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequest(res, 'At least one recipient is required');
    }

    if (userIds.length > 500) {
      return sendBadRequest(res, 'Cannot send to more than 500 recipients at once');
    }

    if (!templateType || !['announcement', 'custom'].includes(templateType)) {
      return sendBadRequest(res, 'Invalid template type');
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return sendBadRequest(res, 'Subject is required');
    }

    if (!messageHtml || typeof messageHtml !== 'string') {
      return sendBadRequest(res, 'Message body is required');
    }

    // Get all selected recipients
    const recipients = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        name: true,
        emailUnsubscribed: true,
      },
    });

    if (recipients.length === 0) {
      return sendBadRequest(res, 'No valid recipients found');
    }

    // Sanitize and convert newlines
    const sanitizedMessage = escapeHtml(messageHtml).replace(/\n/g, '<br>');
    const emailType = templateType === 'announcement' ? 'announcement' : 'custom';

    const results = {
      sent: 0,
      failed: 0,
      suppressed: 0,
    };

    // Send emails sequentially to respect provider rate limits
    for (const recipient of recipients) {
      try {
        const unsubscribeToken = generateUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

        const html = getAnnouncementEmailHtml({
          name: recipient.name || undefined,
          subject: subject.trim(),
          messageHtml: sanitizedMessage,
          unsubscribeUrl,
        });

        const result = await sendEmailWithAudit({
          to: recipient.email,
          subject: subject.trim(),
          html,
          userId: recipient.id,
          emailType,
          triggerSource: 'admin_manual',
          templateVersion: ANNOUNCEMENT_TEMPLATE_VERSION,
        });

        results[result.status]++;
      } catch (error) {
        results.failed++;
        console.error(`[BulkEmail] Failed to send to ${recipient.email}:`, error);
      }
    }

    console.log(
      `[BulkEmail] Admin ${adminUserId} sent ${templateType}: ` +
        `sent=${results.sent}, failed=${results.failed}, suppressed=${results.suppressed}`
    );

    res.json({
      success: true,
      results,
      total: recipients.length,
    });
  } catch (error) {
    logError('Admin email send', error);
    return sendInternalError(res, 'Failed to send emails');
  }
});

/**
 * GET /api/admin/email/history
 * Get recent EmailSend records
 */
router.get('/email/history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      prisma.emailSend.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          toEmail: true,
          emailType: true,
          triggerSource: true,
          status: true,
          createdAt: true,
          failureReason: true,
          user: {
            select: { name: true },
          },
        },
      }),
      prisma.emailSend.count(),
    ]);

    res.json({
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Admin email history', error);
    return sendInternalError(res, 'Failed to fetch email history');
  }
});

// ============================================================================
// Email Scheduling Endpoints
// ============================================================================

/**
 * POST /api/admin/email/schedule
 * Schedule an email to be sent at a future time
 */
router.post('/email/schedule', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Rate limit scheduled emails same as immediate sends
    const rateLimit = await checkAdminRateLimit('bulkEmail', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Please wait before scheduling another email',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { userIds, templateType, subject, messageHtml, scheduledFor } = req.body;

    // Validate inputs
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequest(res, 'At least one recipient is required');
    }

    if (userIds.length > 500) {
      return sendBadRequest(res, 'Cannot schedule email for more than 500 recipients');
    }

    // Validate all IDs are proper format (prevents injection)
    const invalidIds = userIds.filter((id) => !isValidId(id));
    if (invalidIds.length > 0) {
      return sendBadRequest(res, 'Invalid recipient ID format');
    }

    if (!templateType || !['announcement', 'custom'].includes(templateType)) {
      return sendBadRequest(res, 'Invalid template type');
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return sendBadRequest(res, 'Subject is required');
    }

    if (subject.trim().length > MAX_SUBJECT_LENGTH) {
      return sendBadRequest(res, `Subject must be ${MAX_SUBJECT_LENGTH} characters or less`);
    }

    if (!messageHtml || typeof messageHtml !== 'string') {
      return sendBadRequest(res, 'Message body is required');
    }

    if (!scheduledFor || typeof scheduledFor !== 'string') {
      return sendBadRequest(res, 'Scheduled time is required');
    }

    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return sendBadRequest(res, 'Invalid scheduled time format');
    }

    if (scheduledDate <= new Date()) {
      return sendBadRequest(res, 'Scheduled time must be in the future');
    }

    // Verify recipients exist
    const recipients = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });

    if (recipients.length === 0) {
      return sendBadRequest(res, 'No valid recipients found');
    }

    const recipientIds = recipients.map((r) => r.id);

    // Sanitize and convert newlines
    const sanitizedMessage = escapeHtml(messageHtml).replace(/\n/g, '<br>');

    // Create scheduled email record
    const scheduledEmail = await prisma.scheduledEmail.create({
      data: {
        subject: subject.trim(),
        messageHtml: sanitizedMessage,
        templateType,
        recipientIds,
        recipientCount: recipientIds.length,
        scheduledFor: scheduledDate,
        createdBy: adminUserId,
      },
    });

    console.log(
      `[Admin] Scheduled email ${scheduledEmail.id} for ${scheduledDate.toISOString()} ` +
        `(${recipientIds.length} recipients) by ${adminUserId}`
    );

    res.json({
      success: true,
      scheduledEmail: {
        id: scheduledEmail.id,
        subject: scheduledEmail.subject,
        scheduledFor: scheduledEmail.scheduledFor,
        recipientCount: scheduledEmail.recipientCount,
        status: scheduledEmail.status,
      },
    });
  } catch (error) {
    logError('Admin schedule email', error);
    return sendInternalError(res, 'Failed to schedule email');
  }
});

/**
 * GET /api/admin/email/scheduled
 * List scheduled emails with pagination
 */
router.get('/email/scheduled', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const where = status ? { status: status as 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed' } : {};

    const [emails, total] = await Promise.all([
      prisma.scheduledEmail.findMany({
        where,
        orderBy: { scheduledFor: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          subject: true,
          scheduledFor: true,
          recipientCount: true,
          status: true,
          createdAt: true,
          sentCount: true,
          failedCount: true,
          suppressedCount: true,
          processedAt: true,
          errorMessage: true,
        },
      }),
      prisma.scheduledEmail.count({ where }),
    ]);

    res.json({
      emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError('Admin list scheduled emails', error);
    return sendInternalError(res, 'Failed to fetch scheduled emails');
  }
});

/**
 * GET /api/admin/email/scheduled/:id
 * Get a single scheduled email with full details
 */
router.get('/email/scheduled/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const scheduledEmail = await prisma.scheduledEmail.findUnique({
      where: { id },
    });

    if (!scheduledEmail) {
      return sendBadRequest(res, 'Scheduled email not found');
    }

    res.json({ scheduledEmail });
  } catch (error) {
    logError('Admin get scheduled email', error);
    return sendInternalError(res, 'Failed to fetch scheduled email');
  }
});

/**
 * PUT /api/admin/email/scheduled/:id
 * Update a pending scheduled email (atomic - only updates if still pending)
 */
router.put('/email/scheduled/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, messageHtml, scheduledFor } = req.body;

    // Build update data with validation first
    const updateData: {
      subject?: string;
      messageHtml?: string;
      scheduledFor?: Date;
    } = {};

    if (subject !== undefined) {
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        return sendBadRequest(res, 'Subject cannot be empty');
      }
      if (subject.trim().length > MAX_SUBJECT_LENGTH) {
        return sendBadRequest(res, `Subject must be ${MAX_SUBJECT_LENGTH} characters or less`);
      }
      updateData.subject = subject.trim();
    }

    if (messageHtml !== undefined) {
      if (typeof messageHtml !== 'string') {
        return sendBadRequest(res, 'Invalid message body');
      }
      updateData.messageHtml = escapeHtml(messageHtml).replace(/\n/g, '<br>');
    }

    if (scheduledFor !== undefined) {
      const scheduledDate = new Date(scheduledFor);
      if (isNaN(scheduledDate.getTime())) {
        return sendBadRequest(res, 'Invalid scheduled time format');
      }
      if (scheduledDate <= new Date()) {
        return sendBadRequest(res, 'Scheduled time must be in the future');
      }
      updateData.scheduledFor = scheduledDate;
    }

    // Nothing to update
    if (Object.keys(updateData).length === 0) {
      return sendBadRequest(res, 'No valid fields to update');
    }

    // Atomic update - only if still pending (prevents race condition with scheduler)
    const result = await prisma.scheduledEmail.updateMany({
      where: { id, status: 'pending' },
      data: updateData,
    });

    if (result.count === 0) {
      // Either not found or not pending - check which
      const existing = await prisma.scheduledEmail.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!existing) {
        return sendBadRequest(res, 'Scheduled email not found');
      }
      return sendBadRequest(res, `Cannot edit scheduled email with status: ${existing.status}`);
    }

    // Fetch updated record for response
    const updated = await prisma.scheduledEmail.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        scheduledFor: true,
        recipientCount: true,
        status: true,
      },
    });

    console.log(`[Admin] Updated scheduled email ${id}`);

    res.json({ success: true, scheduledEmail: updated });
  } catch (error) {
    logError('Admin update scheduled email', error);
    return sendInternalError(res, 'Failed to update scheduled email');
  }
});

/**
 * DELETE /api/admin/email/scheduled/:id
 * Cancel a pending scheduled email
 */
router.delete('/email/scheduled/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Find the scheduled email
    const existing = await prisma.scheduledEmail.findUnique({
      where: { id },
    });

    if (!existing) {
      return sendBadRequest(res, 'Scheduled email not found');
    }

    if (existing.status !== 'pending') {
      return sendBadRequest(res, `Cannot cancel scheduled email with status: ${existing.status}`);
    }

    // Update status to cancelled
    await prisma.scheduledEmail.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    console.log(`[Admin] Cancelled scheduled email ${id}`);

    res.json({ success: true });
  } catch (error) {
    logError('Admin cancel scheduled email', error);
    return sendInternalError(res, 'Failed to cancel scheduled email');
  }
});

export default router;
