import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const { SESSION_SECRET } = process.env;

export type UnsubscribeTokenPayload = {
  uid: string;
  purpose: 'unsubscribe';
};

/**
 * Unsubscribe links are signed with a key derived from SESSION_SECRET, not the
 * secret itself. They sit in every marketing email for 90 days, and while they
 * were signed with SESSION_SECRET the web session check accepted one pasted
 * into the ll_session cookie as a login. That check now takes web sessions
 * only; the separate key means the two can't be confused again.
 */
function unsubscribeKey(secret: string): string {
  return crypto.createHmac('sha256', secret).update('loam:unsubscribe:v1').digest('hex');
}

function requireSecret(): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return SESSION_SECRET;
}

/**
 * Generate a long-lived unsubscribe token (90 days)
 * Used for email unsubscribe links - no authentication required
 */
export function generateUnsubscribeToken(userId: string): string {
  const payload: UnsubscribeTokenPayload = {
    uid: userId,
    purpose: 'unsubscribe',
  };
  return jwt.sign(payload, unsubscribeKey(requireSecret()), { algorithm: 'HS256', expiresIn: '90d' });
}

function readPayload(token: string, key: string): { userId: string } | null {
  const payload = jwt.verify(token, key, { algorithms: ['HS256'] }) as Partial<UnsubscribeTokenPayload>;
  if (payload.purpose !== 'unsubscribe' || !payload.uid) {
    return null;
  }
  return { userId: payload.uid };
}

/**
 * Verify and decode an unsubscribe token
 * Returns the userId if valid, null if invalid or expired
 *
 * Links already sent were signed with SESSION_SECRET itself, so those are
 * still accepted here (they can't sign anyone in any more). They expire 90 days
 * after they were sent: remove the fallback after 2027-01-15.
 */
export function verifyUnsubscribeToken(token: string): { userId: string } | null {
  const secret = requireSecret();
  try {
    return readPayload(token, unsubscribeKey(secret));
  } catch {
    try {
      return readPayload(token, secret);
    } catch {
      return null;
    }
  }
}

/**
 * Generate a full unsubscribe URL for email links
 */
export function generateUnsubscribeUrl(userId: string): string {
  const token = generateUnsubscribeToken(userId);
  const baseUrl = process.env.FRONTEND_URL || 'https://loamlogger.app';
  return `${baseUrl}/unsubscribe?token=${token}`;
}
