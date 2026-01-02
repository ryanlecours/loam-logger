import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { isAdmin } from './roles';
import { sendUnauthorized, sendForbidden, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';

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
    sendUnauthorized(res);
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { role: true },
    });

    if (!user || !isAdmin(user.role)) {
      sendForbidden(res, 'Admin access required', 'ADMIN_REQUIRED');
      return;
    }

    next();
  } catch (error) {
    logError('AdminMiddleware', error);
    sendInternalError(res);
  }
}
