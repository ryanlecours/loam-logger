import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/** Branded type: an email that has been verified as not already registered */
export type VerifiedUniqueEmail = string & { __brand: 'verified_unique_email' };

/**
 * Verify that an email is not already registered. Returns a branded type
 * required by createNewUser, or `{ available: false }` if the email is taken.
 * Callers should handle the unavailable case with a 409 response.
 */
export async function verifyEmailAvailable(email: string): Promise<{ available: true; email: VerifiedUniqueEmail } | { available: false }> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) return { available: false };
  return { available: true, email: email as VerifiedUniqueEmail };
}

export type CreateNewUserOpts = {
  email: VerifiedUniqueEmail;
  name: string | null;
  passwordHash: string | null;
};

export type CreateNewUserResult = {
  user: { id: string; email: string };
};

/**
 * Create a new active FREE user.
 *
 * This is the single source of truth for user creation across all signup
 * routes (web, mobile). Each route is responsible for:
 * - Validating inputs (name, email, password requirements)
 * - Checking for existing users (this function does NOT check for duplicates —
 *   callers must verify the email is not already registered before calling,
 *   otherwise a P2002 unique constraint error will be thrown instead of a clean 409)
 * - Setting up the auth response (session cookie vs tokens)
 */
export async function createNewUser(opts: CreateNewUserOpts): Promise<CreateNewUserResult> {
  const { email, name, passwordHash } = opts;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: 'FREE',
      subscriptionTier: 'FREE',
      passwordHash,
    },
  });

  logger.info({ email }, 'New user registered');

  return {
    user: { id: user.id, email: user.email },
  };
}
