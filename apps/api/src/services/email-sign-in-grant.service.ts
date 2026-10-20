import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { EMAIL_VERIFICATION_TTL_HOURS, isEmailVerificationPending } from './email-verification.service';

/**
 * Sign-in grants let the client that proved the password sign itself in once
 * the email is verified, without the verification link ever starting a
 * session. Signup and a login refused for an unverified email issue one; the
 * client holds the secret (an httpOnly cookie on web, SecureStore on mobile)
 * and trades it at /auth/verify-email/complete or
 * /auth/mobile/verify-email/complete. Someone who only has the link (a leaked
 * email, a mail scanner) never holds a secret, so they can verify the address
 * but cannot get in.
 */

export type SignInGrantClient = 'web' | 'mobile';

/** Lives as long as the verification link it waits on. */
export const SIGN_IN_GRANT_TTL_HOURS = EMAIL_VERIFICATION_TTL_HOURS;

/**
 * Unused grants an account may hold at once. Each one needed the password, so
 * a few devices can wait in parallel (signed up on the phone, then tried the
 * laptop) without one quietly cancelling another. Older ones are retired.
 */
export const MAX_LIVE_SIGN_IN_GRANTS = 3;

/** API code while the account has not verified yet: keep polling. */
export const EMAIL_VERIFICATION_PENDING_CODE = 'EMAIL_VERIFICATION_PENDING';

/** API code for a secret that can never sign in: stop polling and forget it. */
export const SIGN_IN_GRANT_INVALID_CODE = 'SIGN_IN_GRANT_INVALID';

const SECRET_BYTES = 32;

// A real secret is 43 base64url characters; anything far longer is not one,
// and is refused before it is hashed.
const MAX_SECRET_LENGTH = 128;

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export type SignInGrant = { secret: string; expiresAt: Date };

/**
 * Issue a grant for a client that has just proved the password, retiring all
 * but the newest MAX_LIVE_SIGN_IN_GRANTS live ones. Returns the raw secret;
 * only its hash is stored.
 */
export async function createSignInGrant(userId: string, client: SignInGrantClient): Promise<SignInGrant> {
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + SIGN_IN_GRANT_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { sessionTokenVersion: true },
    });
    await tx.emailSignInGrant.create({
      data: {
        userId,
        secretHash: hashSecret(secret),
        client,
        sessionTokenVersion: user?.sessionTokenVersion ?? 0,
        expiresAt,
      },
    });

    const now = new Date();
    const surplus = await tx.emailSignInGrant.findMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      skip: MAX_LIVE_SIGN_IN_GRANTS,
      select: { id: true },
    });
    if (surplus.length > 0) {
      await tx.emailSignInGrant.updateMany({
        where: { id: { in: surplus.map((g) => g.id) } },
        data: { usedAt: now },
      });
    }
  });

  return { secret, expiresAt };
}

/**
 * createSignInGrant for the signup and login routes, which answer the same
 * whether or not a grant was issued: a failure here must not turn a created
 * account into a 500 (the retry would then be refused as EMAIL_EXISTS). The
 * rider can still verify and sign in with the password. Never throws.
 */
export async function issueSignInGrant(userId: string, client: SignInGrantClient): Promise<SignInGrant | null> {
  try {
    return await createSignInGrant(userId, client);
  } catch (err) {
    logger.error({ err, userId, client }, 'Email sign-in grant issue failed');
    return null;
  }
}

export type SignInGrantUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  mustChangePassword: boolean;
};

export type RedeemSignInGrantResult =
  | { ok: true; user: SignInGrantUser }
  | { ok: false; reason: 'pending' | 'invalid' };

/**
 * Trade a secret for the account it signs in to. `pending` means the email is
 * not verified yet and the secret is still good, so the client polls again.
 * `invalid` covers unknown, used, expired, wrong-client and revoked secrets
 * alike: the holder can only drop it. A secret works once.
 */
export async function redeemSignInGrant(
  secret: unknown,
  client: SignInGrantClient,
): Promise<RedeemSignInGrantResult> {
  if (typeof secret !== 'string' || !secret || secret.length > MAX_SECRET_LENGTH) {
    return { ok: false, reason: 'invalid' };
  }

  const grant = await prisma.emailSignInGrant.findUnique({
    where: { secretHash: hashSecret(secret) },
    select: {
      id: true,
      client: true,
      sessionTokenVersion: true,
      expiresAt: true,
      usedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          mustChangePassword: true,
          emailVerificationRequired: true,
          emailVerified: true,
          sessionTokenVersion: true,
        },
      },
    },
  });

  const now = new Date();
  if (
    !grant ||
    grant.usedAt ||
    grant.expiresAt <= now ||
    grant.client !== client ||
    grant.user.sessionTokenVersion !== grant.sessionTokenVersion
  ) {
    return { ok: false, reason: 'invalid' };
  }

  if (isEmailVerificationPending(grant.user)) {
    return { ok: false, reason: 'pending' };
  }

  // Re-check unused, unexpired and unrevoked in the write itself, so two
  // polls racing, or a password reset landing since the read, cannot both
  // sign in.
  const claimed = await prisma.emailSignInGrant.updateMany({
    where: {
      id: grant.id,
      usedAt: null,
      expiresAt: { gt: now },
      user: { sessionTokenVersion: grant.sessionTokenVersion },
    },
    data: { usedAt: now },
  });
  if (claimed.count === 0) {
    return { ok: false, reason: 'invalid' };
  }

  const { id, email, name, avatarUrl, mustChangePassword } = grant.user;
  return { ok: true, user: { id, email, name, avatarUrl, mustChangePassword } };
}

/** Delete grants that expired more than `olderThanHours` ago. */
export async function cleanupExpiredSignInGrants(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.emailSignInGrant.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
