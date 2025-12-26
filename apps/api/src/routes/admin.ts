import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import { activateWaitlistUser } from '../services/activation.service';
import { sendUnauthorized, sendBadRequest, sendInternalError } from '../lib/api-response';
import { checkAdminRateLimit } from '../lib/rate-limit';

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
    console.error('Admin stats error:', error);
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
    console.error('Admin waitlist error:', error);
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
 * POST /api/admin/migrate-waitlist
 * Creates User records for BetaWaitlist entries that don't have one
 * TEMPORARY: Will be removed after migration is complete
 */
router.post('/migrate-waitlist', async (req, res) => {
  try {
    const adminUserId = req.sessionUser?.uid;
    if (!adminUserId) {
      return sendUnauthorized(res);
    }

    // 1. Get all BetaWaitlist entries
    const waitlistEntries = await prisma.betaWaitlist.findMany({
      select: { email: true, name: true },
    });

    // 2. Get all existing User emails (Set for O(1) lookup)
    const existingUsers = await prisma.user.findMany({
      select: { email: true },
    });
    const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));

    // 3. Filter to entries that need User records
    const toMigrate = waitlistEntries.filter(
      (entry) => !existingEmails.has(entry.email.toLowerCase())
    );

    // 4. Create User records in batches
    let migrated = 0;
    let failed = 0;
    const errors: string[] = [];
    const BATCH_SIZE = 100;

    for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
      const batch = toMigrate.slice(i, i + BATCH_SIZE);

      try {
        await prisma.user.createMany({
          data: batch.map((entry) => ({
            email: entry.email,
            name: entry.name,
            role: 'WAITLIST',
          })),
          skipDuplicates: true,
        });
        migrated += batch.length;
      } catch {
        // Fall back to individual creates if batch fails
        for (const entry of batch) {
          try {
            await prisma.user.create({
              data: {
                email: entry.email,
                name: entry.name,
                role: 'WAITLIST',
              },
            });
            migrated++;
          } catch (individualErr) {
            failed++;
            errors.push(
              `${entry.email}: ${individualErr instanceof Error ? individualErr.message : 'Unknown error'}`
            );
          }
        }
      }
    }

    const skipped = waitlistEntries.length - toMigrate.length;

    console.log(
      `[Admin] Waitlist migration by ${adminUserId}: ` +
        `${migrated} migrated, ${skipped} skipped, ${failed} failed`
    );

    res.json({
      success: true,
      migrated,
      skipped,
      failed,
      total: waitlistEntries.length,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    console.error('Admin migrate-waitlist error:', error);
    return sendInternalError(res, 'Failed to migrate waitlist entries');
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
    console.error('Admin export error:', error);
    return sendInternalError(res, 'Failed to export waitlist');
  }
});

export default router;
