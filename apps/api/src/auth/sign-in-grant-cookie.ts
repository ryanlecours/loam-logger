import type { Request, Response } from 'express';
import type { SignInGrant } from '../services/email-sign-in-grant.service';

const SIGN_IN_GRANT_COOKIE_NAME = 'll_signin_grant';

// Sent only to the verify routes, so no other request carries the secret.
const SIGN_IN_GRANT_COOKIE_PATH = '/auth/verify-email';

function cookieOptions() {
  return {
    httpOnly: true, // Script never needs it: the browser sends it to the exchange
    secure: process.env.APP_ENV === 'production',
    sameSite: (process.env.APP_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
    path: SIGN_IN_GRANT_COOKIE_PATH,
  };
}

/**
 * Hand the web client its sign-in grant. Every tab of this browser can then
 * poll POST /auth/verify-email/complete and is signed in once the email is
 * verified, whichever device opened the link.
 */
export function setSignInGrantCookie(res: Response, grant: SignInGrant): void {
  res.cookie(SIGN_IN_GRANT_COOKIE_NAME, grant.secret, {
    ...cookieOptions(),
    maxAge: Math.max(0, grant.expiresAt.getTime() - Date.now()),
  });
}

export function clearSignInGrantCookie(res: Response): void {
  res.clearCookie(SIGN_IN_GRANT_COOKIE_NAME, cookieOptions());
}

export function readSignInGrantCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SIGN_IN_GRANT_COOKIE_NAME];
  return typeof value === 'string' && value ? value : undefined;
}
