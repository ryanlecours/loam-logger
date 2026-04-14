import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
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

// DB-error alerting state. `isTokenVersionCurrent` is on the hot path for every
// authenticated request, so a DB outage would produce millions of log lines
// and Sentry events per minute. Throttle so the *first* failure after a period
// of health still pages on-call, without burying everything else.
const ALERT_COOLDOWN_MS = 60_000;
let lastDbErrorAlertAt = 0;

function alertOnDbFailure(err: unknown, uid: string): void {
  const now = Date.now();
  if (now - lastDbErrorAlertAt < ALERT_COOLDOWN_MS) {
    // Still log at debug so the full volume is inspectable if needed,
    // but don't spam Sentry or the error channel.
    logger.debug({ err, uid }, '[Session] Token version validation failed (rate-limited)');
    return;
  }
  lastDbErrorAlertAt = now;
  logger.error(
    { err, uid },
    '[Session] Token version validation failed — authentication is failing closed. Investigate DB connectivity immediately.',
  );
  Sentry.captureException(err, {
    tags: { component: 'auth', severity: 'critical' },
    extra: { reason: 'token_version_validation_failed', uid },
  });
}

/**
 * Verify that a parsed token's version claim matches the user's current
 * sessionTokenVersion in the DB. Tokens issued before a revocation event
 * (e.g. password reset) will have a stale `v` and be rejected.
 *
 * Returns true if the token is still valid, false if it has been revoked
 * or the user no longer exists.
 *
 * **Fail-closed on DB error:** if the lookup throws, this returns false so an
 * attacker with a stale token can't bypass revocation by disrupting the DB.
 * The trade-off is that a DB outage denies auth for everyone — we surface
 * that loudly via Sentry + error logs (rate-limited to avoid a firehose).
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
    alertOnDbFailure(err, payload.uid);
    return false;
  }
}

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
        // ignore invalid/expired cookie token — fall through to bearer
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
    // Pass unexpected errors to Express's error handler rather than hanging
    // the request. `isTokenVersionCurrent` already swallows DB errors itself,
    // so this branch should be rare — but if it fires, the request completes
    // deterministically with an error response instead of timing out.
    logger.error({ err }, '[Session] attachUser failed unexpectedly');
    next(err);
  }
}
