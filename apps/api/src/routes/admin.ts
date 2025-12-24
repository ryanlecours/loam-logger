import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';

const router = Router();

// All admin routes require ADMIN role
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Returns dashboard stats for admin
 */
router.get('/stats', async (_req, res) => {
  try {
    const [userCount, waitlistCount] = await Promise.all([
      prisma.user.count(),
      prisma.betaWaitlist.count(),
    ]);

    res.json({
      users: userCount,
      waitlist: waitlistCount,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/admin/waitlist
 * Returns paginated waitlist entries
 */
router.get('/waitlist', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.betaWaitlist.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          referrer: true,
          createdAt: true,
        },
      }),
      prisma.betaWaitlist.count(),
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
