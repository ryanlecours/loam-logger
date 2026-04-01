import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * GET /r/:code - Referral link redirect
 * Validates the referral code and redirects to the signup page with the ref param.
 */
router.get('/r/:code', async (req: Request, res: Response) => {
  const { code } = req.params;

  const user = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });

  if (!user) {
    // Invalid code — redirect to signup without ref param
    res.redirect(`${FRONTEND_URL}/beta-waitlist`);
    return;
  }

  res.redirect(`${FRONTEND_URL}/beta-waitlist?ref=${code}`);
});

export default router;
