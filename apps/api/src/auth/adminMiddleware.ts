import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { isAdmin } from './roles';

/**
 * Middleware that requires the user to have ADMIN role.
 * Must be used after attachUser middleware.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionUser = req.sessionUser;

  if (!sessionUser?.uid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { role: true },
    });

    if (!user || !isAdmin(user.role)) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return;
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
