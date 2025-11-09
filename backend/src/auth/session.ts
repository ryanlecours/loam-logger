import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const { SESSION_SECRET } = process.env;

export type SessionUser = { uid: string; email?: string }

export function setSessionCookie(res: Response, payload: SessionUser) {
  const token = jwt.sign(payload, SESSION_SECRET!, { expiresIn: '7d' });
  res.cookie('ll_session', token, {
    httpOnly: true,
    secure: process.env.APP_ENV === 'production',
    sameSite: 'lax',
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
  const token = req.cookies?.ll_session;
  if (!token) return next();
  try {
    const user = jwt.verify(token, SESSION_SECRET!) as SessionUser;
    req.sessionUser = user;
  } catch {
    // ignore invalid/expired token
  }
  next();
}
