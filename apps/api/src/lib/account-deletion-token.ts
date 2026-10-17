import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const ACCOUNT_DELETION_TTL_MINUTES = 60;

const PURPOSE = 'account_deletion';

type AccountDeletionTokenPayload = {
  uid: string;
  /** The account's email when the link was sent. A changed email voids the link. */
  em: string;
  /**
   * The account's sessionTokenVersion when the link was sent. A password reset
   * or change bumps it, so a rider who resets after a suspected compromise
   * also voids any deletion link sent before.
   */
  v: number;
  purpose: typeof PURPOSE;
};

/**
 * The signing key is derived from SESSION_SECRET rather than being
 * SESSION_SECRET itself. The web session check once accepted any
 * SESSION_SECRET-signed JWT carrying a uid (it now takes web sessions only, see
 * isWebSessionPayload), so a raw-secret deletion link could have acted as a
 * login. A derived key cannot verify there, and session tokens cannot verify
 * here.
 */
function signingKey(): string {
  const { SESSION_SECRET } = process.env;
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return crypto.createHmac('sha256', SESSION_SECRET).update('loam:account-deletion:v1').digest('hex');
}

/**
 * Sign the token emailed to confirm an account deletion request.
 *
 * Stateless on purpose: it needs no table, and it is single-use in practice
 * because redeeming it deletes the account it names.
 */
export function generateAccountDeletionToken(userId: string, email: string, sessionTokenVersion: number): string {
  const payload: AccountDeletionTokenPayload = { uid: userId, em: email, v: sessionTokenVersion, purpose: PURPOSE };
  return jwt.sign(payload, signingKey(), {
    algorithm: 'HS256',
    expiresIn: `${ACCOUNT_DELETION_TTL_MINUTES}m`,
  });
}

export type VerifyAccountDeletionTokenResult =
  | { ok: true; userId: string; email: string; sessionTokenVersion: number }
  | { ok: false; reason: 'expired' | 'invalid' };

export function verifyAccountDeletionToken(token: string): VerifyAccountDeletionTokenResult {
  try {
    const payload = jwt.verify(token, signingKey(), { algorithms: ['HS256'] }) as Partial<AccountDeletionTokenPayload>;
    if (payload.purpose !== PURPOSE || !payload.uid || !payload.em || typeof payload.v !== 'number') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, userId: payload.uid, email: payload.em, sessionTokenVersion: payload.v };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
