import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { resolveReferrer, createUserWithReferralCode } from './referral.service';
import type { UserRole, SubscriptionTier } from '@prisma/client';
import { config } from '../config/env';

/** Branded type: an email that has been verified as not already registered */
export type VerifiedUniqueEmail = string & { __brand: 'verified_unique_email' };

/**
 * Verify that an email is not already registered. Returns a branded type
 * required by createNewUser, or null if the email is taken.
 * Callers should handle the null case with an appropriate 409 response.
 */
export async function verifyEmailAvailable(email: string): Promise<{ available: true; email: VerifiedUniqueEmail } | { available: false; role: string }> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  if (existing) return { available: false, role: existing.role };
  return { available: true, email: email as VerifiedUniqueEmail };
}

export type CreateNewUserOpts = {
  email: VerifiedUniqueEmail;
  name: string | null;
  passwordHash: string | null;
  ref?: string | null;
};

export type CreateNewUserResult = {
  user: { id: string; email: string };
  /** Whether the user was placed on the waitlist (false = direct registration) */
  waitlist: boolean;
};

/**
 * Create a new user with referral handling. Determines role based on
 * BYPASS_WAITLIST_FLOW config. User + referral are created atomically.
 *
 * This is the single source of truth for user creation across all signup
 * routes (web, mobile, waitlist). Each route is responsible for:
 * - Validating inputs (name, email, password requirements)
 * - Checking for existing users (this function does NOT check for duplicates —
 *   callers must verify the email is not already registered before calling,
 *   otherwise a P2002 unique constraint error will be thrown instead of a clean 409)
 * - Setting up the auth response (session cookie vs tokens)
 */
export async function createNewUser(opts: CreateNewUserOpts): Promise<CreateNewUserResult> {
  const { email, name, passwordHash, ref } = opts;

  const referrerId = ref ? await resolveReferrer(ref) : null;
  const bypass = config.bypassWaitlistFlow;

  const role: UserRole = bypass ? 'FREE' : 'WAITLIST';
  const subscriptionTier: SubscriptionTier | undefined = bypass ? 'FREE_LIGHT' : undefined;

  const user = await createUserWithReferralCode((referralCode) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name,
          role,
          ...(subscriptionTier ? { subscriptionTier } : {}),
          referralCode,
          passwordHash,
        },
      });

      if (referrerId) {
        await tx.referral.create({
          data: { referrerUserId: referrerId, referredUserId: created.id },
        });
      }

      return created;
    })
  );

  logger.info({ email, role, hasReferral: !!referrerId }, bypass ? 'New user registered' : 'New waitlist signup');

  return {
    user: { id: user.id, email: user.email },
    waitlist: !bypass,
  };
}
