import jwt from 'jsonwebtoken';

const { SESSION_SECRET } = process.env;

export type UnsubscribeTokenPayload = {
  uid: string;
  purpose: 'unsubscribe';
};

/**
 * Generate a long-lived unsubscribe token (90 days)
 * Used for email unsubscribe links - no authentication required
 */
export function generateUnsubscribeToken(userId: string): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  const payload: UnsubscribeTokenPayload = {
    uid: userId,
    purpose: 'unsubscribe',
  };
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '90d' });
}

/**
 * Verify and decode an unsubscribe token
 * Returns the userId if valid, null if invalid or expired
 */
export function verifyUnsubscribeToken(token: string): { userId: string } | null {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  try {
    const payload = jwt.verify(token, SESSION_SECRET) as UnsubscribeTokenPayload;

    // Validate it's actually an unsubscribe token
    if (payload.purpose !== 'unsubscribe' || !payload.uid) {
      return null;
    }

    return { userId: payload.uid };
  } catch {
    return null;
  }
}
