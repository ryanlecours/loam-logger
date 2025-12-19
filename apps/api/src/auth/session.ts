import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { extractBearerToken, verifyToken } from './token';

const { SESSION_SECRET } = process.env;

export type SessionUser = { uid: string; email?: string }

export function setSessionCookie(res: Response, payload: SessionUser) {
  const token = jwt.sign(payload, SESSION_SECRET!, { expiresIn: '7d' });
  res.cookie('ll_session', token, {
    httpOnly: true,
    secure: process.env.APP_ENV === 'production',
    sameSite: process.env.APP_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie('ll_session', {
    httpOnly: true,
    secure: process.env.APP_ENV === 'production',
    sameSite: 'lax',
  });
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  // First, try cookie-based session (for web)
  const cookieToken = req.cookies?.ll_session;
  if (cookieToken) {
    try {
      const user = jwt.verify(cookieToken, SESSION_SECRET!) as SessionUser;
      req.sessionUser = user;
      return next();
    } catch {
      // ignore invalid/expired cookie token
    }
  }

  // If no cookie, try bearer token (for mobile)
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const user = verifyToken(bearerToken);
    if (user) {
      req.sessionUser = user;
    }
  }

  next();
}
