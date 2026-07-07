import { Prisma, type User } from '@prisma/client';
import { normalizeEmail } from './utils';
import { type AppleClaims } from './types';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type AppleUserResult = { user: User; wasCreated: boolean };

export function ensureUserFromApple(claims: AppleClaims): Promise<AppleUserResult> {
  return ensureUserFromAppleInner(claims, 0);
}

async function ensureUserFromAppleInner(
  claims: AppleClaims,
  retries: number,
): Promise<AppleUserResult> {
  const { sub } = claims;
  // Trusted email from the identity token — safe for account lookup/linking
  const trustedEmail = normalizeEmail(claims.email);
  // Untrusted client-provided email — only used for new user creation
  const clientEmail = normalizeEmail(claims.clientEmail);

  // Phase 1: Check for existing users
  const existing = await prisma.$transaction(async (tx) => {
    // If Apple identity already linked, return existing user
    const existingAccount = await tx.userAccount.findUnique({
      where: { provider_providerUserId: { provider: 'apple', providerUserId: sub } },
      include: { user: true },
    });
    if (existingAccount) {
      // Optionally fill in name if user doesn't have one yet (Apple only sends name on first auth)
      if (!existingAccount.user.name && claims.name) {
        return tx.user.update({
          where: { id: existingAccount.user.id },
          data: { name: claims.name },
        });
      }
      return existingAccount.user;
    }

    // Only use trusted (token-verified) email for account lookup/linking
    if (!trustedEmail) return null;

    const user = await tx.user.findUnique({ where: { email: trustedEmail } });

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

  if (existing) return { user: existing, wasCreated: false };

  // Phase 2: New user — fall back to untrusted client email if token had none.
  // When clientEmail is used, claims.email_verified will be false (the token had
  // no email to verify), so the user is created with emailVerified: null.
  const emailForCreation = trustedEmail ?? clientEmail;
  if (!emailForCreation) {
    throw new Error('Apple login did not provide an email');
  }

  try {
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: emailForCreation,
          name: claims.name ?? null,
          avatarUrl: null,
          emailVerified: claims.email_verified ? new Date() : null,
          role: 'FREE',
          subscriptionTier: 'FREE_LIGHT',
        },
      });

      await tx.userAccount.create({
        data: { userId: created.id, provider: 'apple', providerUserId: sub },
      });

      return created;
    });
    return { user: newUser, wasCreated: true };
  } catch (err) {
    // A concurrent request created this user between Phase 1 and Phase 2.
    // Re-run the full function — Phase 1 will now find the existing user.
    const isEmailCollision =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes('email');

    if (isEmailCollision) {
      logger.warn({ sub, retries }, 'Apple sign-in email-collision retry');
      if (retries >= 2) throw err;
      return ensureUserFromAppleInner(claims, retries + 1);
    }
    throw err;
  }
}
