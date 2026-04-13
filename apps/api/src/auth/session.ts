import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { extractBearerToken, verifyToken } from './token';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const { SESSION_SECRET } = process.env;

export type SessionUser = {
  uid: string;
  email?: string;
  /** Timestamp when this session was created (login time) */
  authAt?: number;
  /** User's sessionTokenVersion at token issue time — used to revoke sessions after password reset */
  v?: number;
}

export function setSessionCookie(res: Response, payload: SessionUser) {
  const token = jwt.sign(payload, SESSION_SECRET!, { expiresIn: '7d' });
  res.cookie('ll_session', token, {
    httpOnly: true,
    secure: process.env.APP_ENV === 'production',
    sameSite: process.env.APP_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/', // Ensure cookie is sent to all routes, not just /auth/*
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie('ll_session', {
    httpOnly: true,
    secure: process.env.APP_ENV === 'production',
    sameSite: process.env.APP_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

/**
 * Verify that a parsed token's version claim matches the user's current
 * sessionTokenVersion in the DB. Tokens issued before a revocation event
 * (e.g. password reset) will have a stale `v` and be rejected.
 *
 * Returns true if the token is still valid, false if it has been revoked
 * or the user no longer exists.
 */
async function isTokenVersionCurrent(payload: { uid: string; v?: number }): Promise<boolean> {
  try {
    const row = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { sessionTokenVersion: true },
    });
    if (!row) return false;
    return (payload.v ?? 0) === row.sessionTokenVersion;
  } catch (err) {
    logger.error({ err, uid: payload.uid }, '[Session] Failed to validate token version');
    // Fail closed — if we can't verify the version, don't trust the token
    return false;
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  // Wrap the async body so middleware errors don't leave Express 4 hanging
  void (async () => {
    try {
      // First, try cookie-based session (for web)
      const cookieToken = req.cookies?.ll_session;
      if (cookieToken) {
        try {
          const user = jwt.verify(cookieToken, SESSION_SECRET!) as SessionUser;
          if (await isTokenVersionCurrent(user)) {
            req.sessionUser = user;
          }
          return next();
        } catch {
          // ignore invalid/expired cookie token
        }
      }

      // If no cookie, try bearer token (for mobile)
      const bearerToken = extractBearerToken(req);
      if (bearerToken) {
        const user = verifyToken(bearerToken);
        if (user && (await isTokenVersionCurrent(user))) {
          req.sessionUser = user;
        }
      }

      next();
    } catch (err) {
      logger.error({ err }, '[Session] attachUser failed');
      next();
    }
  })();
}
