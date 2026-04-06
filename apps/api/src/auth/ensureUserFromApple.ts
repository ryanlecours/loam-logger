import { Prisma } from '@prisma/client';
import { normalizeEmail } from './utils';
import { AUTH_ERROR, type AppleClaims } from './types';
import { prisma } from '../lib/prisma';
import { config } from '../config/env';
import { resolveReferrer, createUserWithReferralCode } from '../services/referral.service';

export async function ensureUserFromApple(
  claims: AppleClaims,
  ref?: string,
) {
  const sub = claims.sub;
  if (!sub) throw new Error('Apple sub is required');

  const email = normalizeEmail(claims.email);

  // Phase 1: Check for existing users
  const existing = await prisma.$transaction(async (tx) => {
    // If Apple identity already linked, return existing user
    const existingAccount = await tx.userAccount.findUnique({
      where: { provider_providerUserId: { provider: 'apple', providerUserId: sub } },
      include: { user: true },
    });
    if (existingAccount) {
      if (existingAccount.user.role === 'WAITLIST') {
        throw new Error(AUTH_ERROR.ALREADY_ON_WAITLIST);
      }
      // Optionally fill in name if user doesn't have one yet (Apple only sends name on first auth)
      if (!existingAccount.user.name && claims.name) {
        await tx.user.update({
          where: { id: existingAccount.user.id },
          data: { name: claims.name },
        });
      }
      return existingAccount.user;
    }

    if (!email) return null;

    const user = await tx.user.findUnique({ where: { email } });

    if (user?.role === 'WAITLIST') {
      throw new Error(AUTH_ERROR.ALREADY_ON_WAITLIST);
    }

    if (user) {
      // User exists and is activated — update profile and link Apple account
      const needsNameUpdate = !user.name && claims.name;
      const needsEmailVerified = claims.email_verified && !user.emailVerified;
      if (needsNameUpdate || needsEmailVerified) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            name: needsNameUpdate ? claims.name : undefined,
            emailVerified: needsEmailVerified ? new Date() : undefined,
          },
        });
      }

      try {
        await tx.userAccount.create({
          data: { userId: user.id, provider: 'apple', providerUserId: sub },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }

      return user;
    }

    // No existing user found
    return null;
  });

  if (existing) return existing;

  // Phase 2: New user — create with referral code retry handling
  if (!email) {
    throw new Error('Apple login did not provide an email');
  }

  if (!config.bypassWaitlistFlow) {
    throw new Error(AUTH_ERROR.CLOSED_BETA);
  }

  const referrerId = ref ? await resolveReferrer(ref) : null;

  try {
    return await createUserWithReferralCode(async (referralCode) => {
      return prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            name: claims.name ?? null,
            avatarUrl: null,
            emailVerified: claims.email_verified ? new Date() : null,
            role: 'FREE',
            subscriptionTier: 'FREE_LIGHT',
            referralCode,
          },
        });

        await tx.userAccount.create({
          data: { userId: newUser.id, provider: 'apple', providerUserId: sub },
        });

        if (referrerId) {
          await tx.referral.create({
            data: { referrerUserId: referrerId, referredUserId: newUser.id },
          });
        }

        return newUser;
      });
    });
  } catch (err) {
    // A concurrent request created this user between Phase 1 and Phase 2.
    // Re-run the full function — Phase 1 will now find the existing user.
    const isEmailCollision =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes('email');

    if (isEmailCollision) {
      return ensureUserFromApple(claims, ref);
    }
    throw err;
  }
}
