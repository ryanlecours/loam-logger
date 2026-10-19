import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
import { extractBearerToken, verifyToken, isAccessTokenPayload, type TokenType } from './token';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { enrichRequestContext, getRequestContext } from '../lib/requestContext';
import { CLIENT_HEADER, resolveClient } from '../lib/clientPlatform';

const { SESSION_SECRET } = process.env;

export type SessionUser = {
  uid: string;
  email?: string;
  /** Timestamp when this session was created (login time) */
  authAt?: number;
  /** User's sessionTokenVersion at token issue time — used to revoke sessions after password reset */
  v?: number;
  /**
   * Which kind of token authenticated the request: 'web' on session cookies
   * issued since the claim existed, the mobile token's own typ on bearer auth.
   */
  typ?: 'web' | TokenType;
}

/**
 * Every claim a web session cookie can carry: what issueWebSession signs plus
 * jwt.sign's timestamps. The only shape issued in the 30 days before `typ`
 * existed was { uid, email, authAt, v }.
 */
const WEB_SESSION_CLAIMS = new Set(['uid', 'email', 'authAt', 'v', 'typ', 'iat', 'exp']);

/**
 * True iff a verified ll_session payload is a web session.
 *
 * Other tokens are signed with the same SESSION_SECRET (mobile access and
 * refresh tokens, and unsubscribe links signed before they moved to their own
 * key), and the cookie path once took any of them that carried a uid: a
 * forwarded marketing email's unsubscribe link signed its holder in as the
 * rider. So the payload must be marked `typ: 'web'`, or, for cookies issued
 * before the mark, carry no claim outside the allowlist. That legacy branch
 * can go once those cookies expire, 7 days after this deploy.
 */
export function isWebSessionPayload(payload: unknown): payload is SessionUser {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.uid !== 'string' || !p.uid) return false;
  if (p.typ !== undefined && p.typ !== 'web') return false;
  return Object.keys(p).every((key) => WEB_SESSION_CLAIMS.has(key));
}

export function setSessionCookie(res: Response, payload: SessionUser) {
  const token = jwt.sign({ ...payload, typ: 'web' }, SESSION_SECRET!, { expiresIn: '7d' });
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
      let user: SessionUser | null = null;
      try {
        const payload = jwt.verify(cookieToken, SESSION_SECRET!, { algorithms: ['HS256'] });
        if (isWebSessionPayload(payload)) {
          user = payload;
        } else {
          // A validly signed token that is not a web session: a mobile token or
          // an emailed link pasted into the cookie. Never a browser's own doing.
          logger.warn(
            { claims: typeof payload === 'object' ? Object.keys(payload).sort() : typeof payload },
            '[Session] Rejected a non-session token in the ll_session cookie'
          );
        }
      } catch {
        // ignore invalid/expired cookie token — fall through to bearer
      }
      if (user) {
        if (await isTokenVersionCurrent(user)) {
          req.sessionUser = user;
          enrichRequestContext({ authTransport: 'cookie' });
        }
        return next();
      }
    }

    // If no cookie, try bearer token (for mobile)
    const bearerToken = extractBearerToken(req);
    if (bearerToken) {
      const user = verifyToken(bearerToken);
      // Access tokens only. A refresh token here would be a year-long
      // credential that never passes through rotation or reuse detection,
      // defeating the point of short-lived access tokens entirely.
      if (user && isAccessTokenPayload(user) && (await isTokenVersionCurrent(user))) {
        req.sessionUser = user;
        enrichRequestContext({ authTransport: 'bearer' });
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

/**
 * Tag the request context with the signed-in user and the calling app (see
 * clientPlatform.ts). Reads the auth transport attachUser records, so it must
 * run after attachUser: mount both through `sessionMiddleware`.
 */
export function enrichContextFromSession(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.sessionUser?.uid ?? req.user?.id;
  if (userId) {
    enrichRequestContext({ userId });
    Sentry.setUser({ id: userId });
  }
  const client = resolveClient({
    header: req.headers[CLIENT_HEADER],
    authTransport: getRequestContext()?.authTransport,
    path: req.path,
  });
  if (client) enrichRequestContext({ client });
  next();
}

/**
 * attachUser, then enrichContextFromSession. Mounted as one unit so the two
 * can't be reordered: tagging before auth would drop the cookie and bearer
 * fallbacks and leave older app builds untagged.
 */
export const sessionMiddleware = [attachUser, enrichContextFromSession];
