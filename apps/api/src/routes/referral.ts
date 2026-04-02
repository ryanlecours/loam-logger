import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { FRONTEND_URL } from '../config/env';

const router = Router();

/**
 * GET /r/:code - Referral link redirect
 * Validates the referral code and redirects to the signup page with the ref param.
 */
router.get('/r/:code', async (req: Request, res: Response) => {
  const { code } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });

    if (!user) {
      res.redirect(`${FRONTEND_URL}/signup`);
      return;
    }

    res.redirect(`${FRONTEND_URL}/signup?ref=${code}`);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), code }, 'Referral redirect failed');
    // Redirect to signup so the referred user isn't stranded
    res.redirect(`${FRONTEND_URL}/signup`);
  }
});

export default router;
