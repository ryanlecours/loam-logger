import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { canonicalizeEmail } from '../auth/utils';

/** Branded type: an email that has been verified as not already registered */
export type VerifiedUniqueEmail = string & { __brand: 'verified_unique_email' };

/**
 * Verify that an email is not already registered. Returns a branded type
 * required by createNewUser, or `{ available: false }` if the email is taken.
 * Callers should handle the unavailable case with a 409 response.
 *
 * "Taken" includes another spelling of the same inbox: Gmail dots, a +tag,
 * or googlemail.com (see canonicalizeEmail), so one inbox cannot open a
 * stack of accounts.
 *
 * The folded check is check-then-insert with no unique constraint behind it
 * (emailCanonical is indexed but not unique, because existing accounts can
 * already collide). Two concurrent signups spelling one inbox differently can
 * therefore both succeed. That is accepted: each is still gated on that same
 * inbox clicking a link, unverified ones are purged after 14 days, and the
 * per-IP signup windows bound how often anyone can try. The exact `email`
 * stays unique in the database, so an identical address can never get in twice.
 */
export async function verifyEmailAvailable(email: string): Promise<{ available: true; email: VerifiedUniqueEmail } | { available: false }> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { emailCanonical: canonicalizeEmail(email) }] },
    select: { id: true },
  });

  if (existing) return { available: false };
  return { available: true, email: email as VerifiedUniqueEmail };
}

export type CreateNewUserOpts = {
  email: VerifiedUniqueEmail;
  name: string | null;
  passwordHash: string | null;
  /** Client IP and user agent, kept for abuse review in the admin Users page. */
  signupIp?: string | null;
  signupUserAgent?: string | null;
  /** Device attestation verdict label (mobile password signup only). */
  signupAttestation?: string | null;
};

export type CreateNewUserResult = {
  user: { id: string; email: string; name: string | null };
};

/**
 * Create a new FREE user that must verify its email before signing in.
 *
 * This is the single source of truth for password signup across all routes
 * (web, mobile). Each route is responsible for:
 * - Validating inputs (name, email, password requirements)
 * - Checking for existing users (this function does NOT check for duplicates;
 *   callers must verify the email is not already registered before calling,
 *   otherwise a P2002 unique constraint error will be thrown instead of a clean 409)
 * - Sending the verification email and answering without a session
 */
export async function createNewUser(opts: CreateNewUserOpts): Promise<CreateNewUserResult> {
  const { email, name, passwordHash, signupIp, signupUserAgent, signupAttestation } = opts;

  const user = await prisma.user.create({
    data: {
      email,
      emailCanonical: canonicalizeEmail(email),
      emailVerificationRequired: true,
      name,
      role: 'FREE',
      subscriptionTier: 'FREE',
      passwordHash,
      signupIp: signupIp ?? null,
      signupUserAgent: signupUserAgent ?? null,
      signupAttestation: signupAttestation ?? null,
    },
  });

  logger.info({ userId: user.id }, 'New user registered');

  return {
    user: { id: user.id, email: user.email, name: user.name },
  };
}
