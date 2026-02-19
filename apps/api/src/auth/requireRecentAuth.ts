import type { Request, Response, NextFunction } from 'express';
import { checkRecentAuth } from './recent-auth';
import { sendUnauthorized, sendForbidden } from '../lib/api-response';

/**
 * Middleware that requires recent authentication (within 10 minutes).
 * Returns 403 with RECENT_AUTH_REQUIRED code if auth is stale.
 *
 * Use this to gate sensitive operations like adding/changing passwords.
 */
export async function requireRecentAuth(req: Request, res: Response, next: NextFunction) {
  const sessionUser = req.sessionUser;
  if (!sessionUser?.uid) {
    return sendUnauthorized(res);
  }

  // Pass session authAt as fallback in case DB lastAuthAt write failed
  const result = await checkRecentAuth(sessionUser.uid, sessionUser.authAt);

  if (!result.valid) {
    return sendForbidden(
      res,
      'This action requires recent authentication. Please log in again.',
      'RECENT_AUTH_REQUIRED'
    );
  }

  next();
}
