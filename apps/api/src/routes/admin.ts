import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import { activateWaitlistUser } from '../services/activation.service';

const router = Router();

// All admin routes require ADMIN role
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Returns dashboard stats for admin
 */
router.get('/stats', async (_req, res) => {
  try {
    const [activeUserCount, waitlistCount, proCount] = await Promise.all([
      prisma.user.count({ where: { role: { in: ['FREE', 'PRO', 'ADMIN'] } } }),
      prisma.user.count({ where: { role: 'WAITLIST' } }),
      prisma.user.count({ where: { role: 'PRO' } }),
    ]);

    res.json({
      users: activeUserCount,
      waitlist: waitlistCount,
      pro: proCount,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
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
    res.status(500).json({ error: 'Failed to fetch waitlist' });
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
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate userId parameter
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const result = await activateWaitlistUser({ userId: userId.trim(), adminUserId });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate user';
    console.error('Admin activate error:', message);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/admin/waitlist/export
 * Downloads waitlist as CSV
 */
router.get('/waitlist/export', async (_req, res) => {
  try {
    const entries = await prisma.betaWaitlist.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        email: true,
        name: true,
        referrer: true,
        createdAt: true,
      },
    });

    // Build CSV
    const headers = ['Email', 'Name', 'Referrer', 'Signed Up'];
    const rows = entries.map((entry) => [
      entry.email,
      entry.name || '',
      entry.referrer || '',
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
    res.status(500).json({ error: 'Failed to export waitlist' });
  }
});

export default router;
