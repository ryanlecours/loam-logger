import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import { activateWaitlistUser, generateTempPassword } from '../services/activation.service';
import { hashPassword } from '../auth/password.utils';
import { sendEmail, sendReactEmailWithAudit } from '../services/email.service';
import {
  getTemplateListForAPI,
  getTemplateById,
  type TemplateConfig,
} from '../templates/emails';
import FoundingRidersEmail, { FOUNDING_RIDERS_TEMPLATE_VERSION } from '../templates/emails/founding-riders';
import FoundingRidersLaunchEmail, { FOUNDING_RIDERS_POST_ACTIVATION_INFO_TEMPLATE_VERSION } from '../templates/emails/pre-access';
import { render } from '@react-email/render';
import React from 'react';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { sendUnauthorized, sendBadRequest, sendInternalError } from '../lib/api-response';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { logError } from '../lib/logger';
import { escapeHtml } from '../lib/html';
import type { UserRole } from '@prisma/client';
import { getActivationEmailHtml, getActivationEmailSubject } from '../templates/emails/activation';

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

/** Delay helper for rate limiting */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay between emails to respect Resend's 1/second rate limit */
const EMAIL_SEND_DELAY_MS = 1100; // 1.1 seconds for safety margin

const router = Router();

// All admin routes require ADMIN role
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Returns dashboard stats for admin
 */
router.get('/stats', async (_req, res) => {
  try {
    // Get role counts and founding rider count in parallel
    const [roleCounts, foundingRidersCount] = await Promise.all([
      prisma.user.groupBy({
        by: ['role'],
        _count: { role: true },
      }),
      prisma.user.count({ where: { isFoundingRider: true } }),
    ]);

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
      foundingRiders: foundingRidersCount,
      pro: proCount,
    });
  } catch (error) {
    logError('Admin stats', error);
    return sendInternalError(res, 'Failed to fetch stats');
  }
});

/**
 * GET /api/admin/lookup-user
 * Look up a user by email address - useful for finding userId for log filtering
 */
router.get('/lookup-user', async (req, res) => {
  try {
    const email = req.query.email as string | undefined;

    if (!email || typeof email !== 'string') {
      return sendBadRequest(res, 'Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > MAX_EMAIL_LENGTH) {
      return sendBadRequest(res, 'Invalid email format');
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        activatedAt: true,
        isFoundingRider: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logError('Admin lookup-user', error);
    return sendInternalError(res, 'Failed to look up user');
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
          isFoundingRider: true,
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

    // Validate role (WAITLIST users are created via signup, not admin)
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
          html: await getActivationEmailHtml({
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

    // Build response with clear warning if email failed
    const emailFailed = sendActivationEmail && !emailSent;
    res.json({
      success: true,
      user,
      emailQueued: emailSent,
      // Return temp password and warning if email failed
      ...(emailFailed && tempPassword
        ? {
            tempPassword,
            warning:
              'Activation email failed to send. Please share this temporary password with the user manually.',
          }
        : {}),
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

    // Prevent demoting the last admin
    if (user.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return sendBadRequest(res, 'Cannot demote the last admin user');
      }
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
 * PATCH /api/admin/users/:userId/founding-rider
 * Toggle the isFoundingRider flag for a WAITLIST user
 * Body: { isFoundingRider: boolean }
 */
router.patch('/users/:userId/founding-rider', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    const { userId } = req.params;
    const { isFoundingRider } = req.body;

    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    if (typeof isFoundingRider !== 'boolean') {
      return sendBadRequest(res, 'isFoundingRider must be a boolean');
    }

    // Verify user exists and is WAITLIST
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isFoundingRider: true },
    });

    if (!user) {
      return sendBadRequest(res, 'User not found');
    }

    if (user.role !== 'WAITLIST') {
      return sendBadRequest(res, 'Can only toggle founding rider status for waitlist users');
    }

    // Update founding rider flag
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isFoundingRider },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isFoundingRider: true,
      },
    });

    console.log(
      `[Admin] User ${user.email} founding rider status set to ${isFoundingRider} by ${adminUserId}`
    );

    res.json({ success: true, user: updated });
  } catch (error) {
    logError('Admin toggle founding rider', error);
    return sendInternalError(res, 'Failed to update founding rider status');
  }
});

/**
 * PATCH /api/admin/users/founding-rider/bulk
 * Set isFoundingRider flag for multiple WAITLIST users
 * Body: { userIds: string[], isFoundingRider: boolean }
 */
router.patch('/users/founding-rider/bulk', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    const { userIds, isFoundingRider } = req.body;

    // Validate input
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return sendBadRequest(res, 'At least one user ID is required');
    }

    if (userIds.length > 100) {
      return sendBadRequest(res, 'Cannot update more than 100 users at once');
    }

    if (typeof isFoundingRider !== 'boolean') {
      return sendBadRequest(res, 'isFoundingRider must be a boolean');
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
        throw new Error(`Cannot update ${nonWaitlistUsers.length} user(s) not on waitlist`);
      }

      const validUserIds = users.map((u) => u.id);

      // Update founding rider flag for all valid users
      await tx.user.updateMany({
        where: { id: { in: validUserIds } },
        data: { isFoundingRider },
      });

      return {
        updatedCount: validUserIds.length,
        updatedEmails: users.map((u) => u.email),
      };
    });

    console.log(
      `[Admin] ${result.updatedCount} users founding rider status set to ${isFoundingRider} by ${adminUserId}`
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    // Handle transaction validation errors separately
    if (error instanceof Error && error.message.includes('Cannot update')) {
      return sendBadRequest(res, error.message);
    }
    logError('Admin bulk founding rider', error);
    return sendInternalError(res, 'Failed to update founding rider status');
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

    // Prevent deleting the last admin
    if (user.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        return sendBadRequest(res, 'Cannot delete the last admin user');
      }
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
          emailUnsubscribed: true,
          isFoundingRider: true,
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

/**
 * POST /api/admin/waitlist/import
 * Import waitlist users from CSV data
 * Body: { users: Array<{ email: string; name?: string; signedUp?: string }> }
 */
router.post('/waitlist/import', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Rate limit to prevent abuse
    const rateLimit = await checkAdminRateLimit('importWaitlist', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Please wait before importing again',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { users } = req.body;

    // Validate input
    if (!Array.isArray(users) || users.length === 0) {
      return sendBadRequest(res, 'At least one user is required');
    }

    if (users.length > 500) {
      return sendBadRequest(res, 'Cannot import more than 500 users at once');
    }

    // Process and validate each row
    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ row: number; email: string; reason: string }>,
    };

    // Get all existing emails in one query for efficiency
    const inputEmails = users
      .map((u) => (typeof u.email === 'string' ? u.email.toLowerCase().trim() : ''))
      .filter((e) => e);

    const existingUsers = await prisma.user.findMany({
      where: { email: { in: inputEmails } },
      select: { email: true },
    });
    const existingEmailSet = new Set(existingUsers.map((u) => u.email));

    // Track emails we're about to create to handle duplicates within the CSV
    const seenEmails = new Set<string>();

    // Prepare valid users for batch creation
    const usersToCreate: Array<{
      email: string;
      name: string | null;
      role: 'WAITLIST';
      createdAt: Date;
    }> = [];

    for (let i = 0; i < users.length; i++) {
      const row = i + 1; // 1-indexed for user-friendly messages
      const user = users[i];

      // Validate email
      if (!user.email || typeof user.email !== 'string') {
        results.errors.push({ row, email: '', reason: 'Missing email' });
        continue;
      }

      const email = user.email.toLowerCase().trim();

      if (email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
        results.errors.push({ row, email, reason: 'Invalid email format' });
        continue;
      }

      // Check for duplicates in existing database
      if (existingEmailSet.has(email)) {
        results.skipped++;
        continue;
      }

      // Check for duplicates within this import
      if (seenEmails.has(email)) {
        results.skipped++;
        continue;
      }

      seenEmails.add(email);

      // Parse signedUp date if provided
      let createdAt = new Date();
      if (user.signedUp && typeof user.signedUp === 'string') {
        const parsed = new Date(user.signedUp);
        if (!isNaN(parsed.getTime())) {
          createdAt = parsed;
        }
      }

      usersToCreate.push({
        email,
        name: user.name?.trim() || null,
        role: 'WAITLIST',
        createdAt,
      });
    }

    // Batch create all valid users
    if (usersToCreate.length > 0) {
      await prisma.user.createMany({
        data: usersToCreate,
        skipDuplicates: true, // Safety net for race conditions
      });
      results.imported = usersToCreate.length;
    }

    console.log(
      `[Admin] Waitlist import by ${adminUserId}: ` +
        `imported=${results.imported}, skipped=${results.skipped}, errors=${results.errors.length}`
    );

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logError('Admin waitlist import', error);
    return sendInternalError(res, 'Failed to import waitlist');
  }
});

// ============================================================================
// Email Management Endpoints
// ============================================================================

const VALID_EMAIL_ROLES: UserRole[] = ['WAITLIST', 'FREE', 'PRO', 'ADMIN'];

/**
 * GET /api/admin/email/recipients
 * List users by role with email/name/unsubscribed status for checkbox selection
 * Query params:
 *   - role: UserRole or UserRole[] (required) - can be single or multiple roles
 *   - foundingRider: 'true' | 'false' (optional, filter by founding rider status)
 */
router.get('/email/recipients', async (req, res) => {
  try {
    const { role, foundingRider } = req.query;

    // Support both single role and array of roles
    const roles: string[] = Array.isArray(role)
      ? role.filter((r): r is string => typeof r === 'string')
      : typeof role === 'string'
        ? [role]
        : [];

    if (roles.length === 0) {
      return sendBadRequest(res, `Role must be one of: ${VALID_EMAIL_ROLES.join(', ')}`);
    }

    // Validate all roles
    const invalidRoles = roles.filter(r => !VALID_EMAIL_ROLES.includes(r as UserRole));
    if (invalidRoles.length > 0) {
      return sendBadRequest(res, `Invalid role(s): ${invalidRoles.join(', ')}. Must be one of: ${VALID_EMAIL_ROLES.join(', ')}`);
    }

    // Build where clause with optional founding rider filter
    const where: { role: { in: UserRole[] }; isFoundingRider?: boolean } = {
      role: { in: roles as UserRole[] },
    };

    if (foundingRider === 'true') {
      where.isFoundingRider = true;
    } else if (foundingRider === 'false') {
      where.isFoundingRider = false;
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        emailUnsubscribed: true,
        isFoundingRider: true,
      },
    });

    res.json({ users });
  } catch (error) {
    logError('Admin email recipients', error);
    return sendInternalError(res, 'Failed to fetch recipients');
  }
});

// ============================================================================
// Founding Riders Email Endpoints
// ============================================================================

/**
 * POST /api/admin/email/founding-riders/preview
 * Preview the founding riders welcome email
 */
router.post('/email/founding-riders/preview', async (req, res) => {
  try {
    const { activationDateText } = req.body;

    if (!activationDateText || typeof activationDateText !== 'string') {
      return sendBadRequest(res, 'activationDateText is required');
    }

    // Render the email with sample data for preview
    const html = await render(
      React.createElement(FoundingRidersEmail, {
        recipientFirstName: 'Preview',
        activationDateText,
        appUrl: FRONTEND_URL,
        unsubscribeUrl: `${API_URL}/api/email/unsubscribe?token=preview`,
      })
    );

    res.json({
      success: true,
      subject: 'Welcome to Loam Logger, Founding Riders',
      html,
    });
  } catch (error) {
    logError('Admin founding riders preview', error);
    return sendInternalError(res, 'Failed to generate preview');
  }
});

/**
 * POST /api/admin/email/founding-riders
 * Send founding riders welcome email to selected recipients
 */
router.post('/email/founding-riders', async (req, res) => {
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

    const { recipientIds, activationDateText } = req.body;

    // Validate inputs
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return sendBadRequest(res, 'At least one recipient is required');
    }

    if (recipientIds.length > 500) {
      return sendBadRequest(res, 'Cannot send to more than 500 recipients at once');
    }

    // Validate all IDs are proper format
    const invalidIds = recipientIds.filter((id) => !isValidId(id));
    if (invalidIds.length > 0) {
      return sendBadRequest(res, 'Invalid recipient ID format');
    }

    if (!activationDateText || typeof activationDateText !== 'string') {
      return sendBadRequest(res, 'activationDateText is required');
    }

    // Fetch recipients - must be founding riders
    const recipients = await prisma.user.findMany({
      where: {
        id: { in: recipientIds },
        isFoundingRider: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        emailUnsubscribed: true,
      },
    });

    if (recipients.length === 0) {
      return sendBadRequest(res, 'No valid founding rider recipients found');
    }

    const results = { sent: 0, failed: 0, suppressed: 0 };
    const subject = 'Welcome to Loam Logger, Founding Riders';

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];

      // Add delay between emails (except before first)
      if (i > 0) {
        await sleep(EMAIL_SEND_DELAY_MS);
      }

      try {
        const unsubscribeToken = generateUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

        // Extract first name from full name
        const firstName = recipient.name?.split(' ')[0] || undefined;

        const result = await sendReactEmailWithAudit({
          to: recipient.email,
          subject,
          reactElement: React.createElement(FoundingRidersEmail, {
            recipientFirstName: firstName,
            activationDateText,
            appUrl: FRONTEND_URL,
            unsubscribeUrl,
          }),
          userId: recipient.id,
          emailType: 'founding_welcome',
          triggerSource: 'admin_manual',
          templateVersion: FOUNDING_RIDERS_TEMPLATE_VERSION,
        });

        results[result.status]++;
      } catch (error) {
        logError(`Founding riders email to ${recipient.email}`, error);
        results.failed++;
      }
    }

    console.log(
      `[Admin] Founding riders email sent by ${adminUserId}: ${results.sent} sent, ${results.failed} failed, ${results.suppressed} suppressed`
    );

    res.json({
      success: true,
      results,
      total: recipients.length,
    });
  } catch (error) {
    logError('Admin founding riders email send', error);
    return sendInternalError(res, 'Failed to send emails');
  }
});

// ============================================================================
// Pre-Access Launch Email Endpoints
// ============================================================================

/**
 * POST /api/admin/email/pre-access/preview
 * Preview the pre-access launch email
 */
router.post('/email/pre-access/preview', async (_req, res) => {
  try {
    const html = await render(
      React.createElement(FoundingRidersLaunchEmail, {
        recipientFirstName: 'Preview',
        appUrl: FRONTEND_URL,
        unsubscribeUrl: `${API_URL}/api/email/unsubscribe?token=preview`,
      })
    );

    res.json({
      success: true,
      subject: 'Founding Riders access is live',
      html,
    });
  } catch (error) {
    logError('Admin pre-access preview', error);
    return sendInternalError(res, 'Failed to generate preview');
  }
});

/**
 * POST /api/admin/email/pre-access
 * Send pre-access launch email to selected recipients
 */
router.post('/email/pre-access', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    const rateLimit = await checkAdminRateLimit('bulkEmail', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Please wait before sending another bulk email',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { recipientIds } = req.body;

    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return sendBadRequest(res, 'At least one recipient is required');
    }

    if (recipientIds.length > 500) {
      return sendBadRequest(res, 'Cannot send to more than 500 recipients at once');
    }

    const invalidIds = recipientIds.filter((id) => !isValidId(id));
    if (invalidIds.length > 0) {
      return sendBadRequest(res, 'Invalid recipient ID format');
    }

    const recipients = await prisma.user.findMany({
      where: { id: { in: recipientIds } },
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

    const results = { sent: 0, failed: 0, suppressed: 0 };
    const subject = 'Founding Riders access is live';

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];

      // Add delay between emails (except before first)
      if (i > 0) {
        await sleep(EMAIL_SEND_DELAY_MS);
      }

      try {
        const unsubscribeToken = generateUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;
        const firstName = recipient.name?.split(' ')[0] || undefined;

        const result = await sendReactEmailWithAudit({
          to: recipient.email,
          subject,
          reactElement: React.createElement(FoundingRidersLaunchEmail, {
            recipientFirstName: firstName,
            appUrl: FRONTEND_URL,
            unsubscribeUrl,
          }),
          userId: recipient.id,
          emailType: 'founding_welcome',
          triggerSource: 'admin_manual',
          templateVersion: FOUNDING_RIDERS_POST_ACTIVATION_INFO_TEMPLATE_VERSION,
        });

        results[result.status]++;
      } catch (error) {
        logError(`Pre-access email to ${recipient.email}`, error);
        results.failed++;
      }
    }

    console.log(
      `[Admin] Pre-access email sent by ${adminUserId}: ${results.sent} sent, ${results.failed} failed, ${results.suppressed} suppressed`
    );

    res.json({
      success: true,
      results,
      total: recipients.length,
    });
  } catch (error) {
    logError('Admin pre-access email send', error);
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

    // Validate status if provided
    const validStatuses = ['pending', 'processing', 'sent', 'cancelled', 'failed'] as const;
    if (status && !validStatuses.includes(status as typeof validStatuses[number])) {
      return sendBadRequest(res, 'Invalid status filter');
    }
    const where = status ? { status: status as typeof validStatuses[number] } : {};

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
          recipientIds: true,
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

    // Fetch recipient emails for all scheduled emails
    const allRecipientIds = [...new Set(emails.flatMap((e) => e.recipientIds))];
    const users = await prisma.user.findMany({
      where: { id: { in: allRecipientIds } },
      select: { id: true, email: true },
    });
    const userEmailMap = new Map(users.map((u) => [u.id, u.email]));

    // Add recipient emails to each scheduled email
    const emailsWithRecipients = emails.map((email) => ({
      ...email,
      recipientEmails: email.recipientIds
        .map((id) => userEmailMap.get(id))
        .filter((email): email is string => !!email),
    }));

    res.json({
      emails: emailsWithRecipients,
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

// ===== UNIFIED EMAIL TEMPLATE ENDPOINTS =====

/**
 * GET /api/admin/email/templates
 * Returns list of available email templates with their parameters
 */
router.get('/email/templates', async (_req, res) => {
  try {
    const templates = getTemplateListForAPI();
    res.json({ templates });
  } catch (error) {
    logError('Admin get templates', error);
    return sendInternalError(res, 'Failed to fetch templates');
  }
});

/**
 * Helper to build template props from user-provided parameters
 */
function buildTemplateProps(
  template: TemplateConfig,
  userParameters: Record<string, string>,
  autoFillValues: { recipientFirstName?: string; email?: string; unsubscribeUrl?: string }
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  for (const param of template.parameters) {
    // Auto-fill values take precedence for special fields
    if (param.autoFill && autoFillValues[param.autoFill] !== undefined) {
      props[param.key] = autoFillValues[param.autoFill];
    } else if (userParameters[param.key] !== undefined && userParameters[param.key] !== '') {
      props[param.key] = userParameters[param.key];
    } else if (param.defaultValue !== undefined) {
      // Replace URL placeholders
      props[param.key] = param.defaultValue
        .replace('${FRONTEND_URL}', FRONTEND_URL)
        .replace('${API_URL}', API_URL);
    }
  }

  return props;
}

/**
 * Validate that required template parameters are present and properly typed.
 * Throws an error if validation fails.
 */
function validateTemplateProps(
  template: TemplateConfig,
  props: Record<string, unknown>
): { valid: true } | { valid: false; error: string } {
  for (const param of template.parameters) {
    if (param.required) {
      const value = props[param.key];
      if (value === undefined || value === null || value === '') {
        return { valid: false, error: `${param.label} is required` };
      }
      if (typeof value !== 'string') {
        return { valid: false, error: `${param.label} must be a string` };
      }
    }
  }
  return { valid: true };
}

/**
 * POST /api/admin/email/unified/preview
 * Preview any email template with provided parameters
 */
router.post('/email/unified/preview', async (req, res) => {
  try {
    const { templateId, parameters = {}, subject } = req.body;

    if (!templateId || typeof templateId !== 'string') {
      return sendBadRequest(res, 'templateId is required');
    }

    if (typeof parameters !== 'object' || Array.isArray(parameters) || parameters === null) {
      return sendBadRequest(res, 'parameters must be an object');
    }

    const template = getTemplateById(templateId);
    if (!template) {
      return sendBadRequest(res, 'Invalid template ID');
    }

    // Build props with preview placeholder values
    const props = buildTemplateProps(template, parameters, {
      recipientFirstName: 'Preview User',
      email: 'preview@example.com',
      unsubscribeUrl: '#preview-unsubscribe',
    });

    // Validate required parameters
    const validation = validateTemplateProps(template, props);
    if (!validation.valid) {
      return sendBadRequest(res, validation.error);
    }

    // Render the template
    const html = await render(template.render(props));

    res.json({
      success: true,
      subject: subject || template.defaultSubject,
      html,
    });
  } catch (error) {
    logError('Admin unified preview', error);
    return sendInternalError(res, 'Failed to generate preview');
  }
});

/**
 * POST /api/admin/email/unified/send
 * Send any email template to selected recipients
 */
router.post('/email/unified/send', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // Validate required environment variables for email URLs
    if (!process.env.FRONTEND_URL || !process.env.API_URL) {
      console.error('[Admin] Missing required environment variables: FRONTEND_URL or API_URL not set');
      return sendInternalError(res, 'Server configuration error');
    }

    // Rate limit
    const rateLimit = await checkAdminRateLimit('bulkEmail', adminUserId);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', rateLimit.retryAfter.toString());
      return res.status(429).json({
        success: false,
        error: 'Please wait before sending another bulk email',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { templateId, recipientIds, parameters = {}, subject } = req.body;

    // Validate templateId
    if (!templateId || typeof templateId !== 'string') {
      return sendBadRequest(res, 'templateId is required');
    }

    if (typeof parameters !== 'object' || Array.isArray(parameters) || parameters === null) {
      return sendBadRequest(res, 'parameters must be an object');
    }

    const template = getTemplateById(templateId);
    if (!template) {
      return sendBadRequest(res, 'Invalid template ID');
    }

    // Validate required non-autofilled parameters upfront
    // (autofilled params like recipientFirstName are filled per-recipient)
    const testProps = buildTemplateProps(template, parameters, {
      recipientFirstName: 'Test',
      email: 'test@example.com',
      unsubscribeUrl: '#test',
    });
    const validation = validateTemplateProps(template, testProps);
    if (!validation.valid) {
      return sendBadRequest(res, validation.error);
    }

    // Validate recipients
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return sendBadRequest(res, 'At least one recipient is required');
    }

    if (recipientIds.length > 500) {
      return sendBadRequest(res, 'Cannot send to more than 500 recipients at once');
    }

    // Validate all IDs
    const invalidIds = recipientIds.filter((id: unknown) => !isValidId(id));
    if (invalidIds.length > 0) {
      return sendBadRequest(res, 'Invalid recipient ID format');
    }

    // Fetch recipients
    const recipients = await prisma.user.findMany({
      where: { id: { in: recipientIds } },
      select: { id: true, email: true, name: true, emailUnsubscribed: true },
    });

    if (recipients.length === 0) {
      return sendBadRequest(res, 'No valid recipients found');
    }

    const emailSubject = subject || template.defaultSubject;
    const results = { sent: 0, failed: 0, suppressed: 0 };

    // Send emails sequentially with delay
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      if (i > 0) await sleep(EMAIL_SEND_DELAY_MS);

      try {
        // Skip unsubscribed users
        if (recipient.emailUnsubscribed) {
          results.suppressed++;
          continue;
        }

        const unsubscribeToken = generateUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;
        const firstName = recipient.name?.split(' ')[0] || undefined;

        // Build per-recipient props
        const props = buildTemplateProps(template, parameters, {
          recipientFirstName: firstName,
          email: recipient.email,
          unsubscribeUrl,
        });

        const result = await sendReactEmailWithAudit({
          to: recipient.email,
          subject: emailSubject,
          reactElement: template.render(props),
          userId: recipient.id,
          emailType: template.emailType,
          triggerSource: 'admin_manual',
          templateVersion: template.templateVersion,
        });

        if (result.status === 'sent') {
          results.sent++;
        } else if (result.status === 'suppressed') {
          results.suppressed++;
        } else {
          results.failed++;
        }
      } catch (error) {
        logError(`Unified email to ${recipient.email}`, error);
        results.failed++;
      }
    }

    console.log(
      `[Admin] Unified email (${templateId}) sent by ${adminUserId}: ` +
        `${results.sent} sent, ${results.failed} failed, ${results.suppressed} suppressed`
    );

    res.json({ success: true, results, total: recipients.length });
  } catch (error) {
    logError('Admin unified send', error);
    return sendInternalError(res, 'Failed to send emails');
  }
});

export default router;
