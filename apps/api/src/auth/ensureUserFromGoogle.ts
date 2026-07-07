import { Prisma, type User } from '@prisma/client';
import { normalizeEmail, computeExpiry } from './utils';
import { type GoogleClaims, type GoogleTokens } from './types';
import { prisma } from '../lib/prisma';

export type GoogleUserResult = { user: User; wasCreated: boolean };

export function ensureUserFromGoogle(
  claims: GoogleClaims,
  tokens?: GoogleTokens,
): Promise<GoogleUserResult> {
  return ensureUserFromGoogleInner(claims, tokens, 0);
}

async function ensureUserFromGoogleInner(
  claims: GoogleClaims,
  tokens: GoogleTokens | undefined,
  retries: number,
): Promise<GoogleUserResult> {
  const sub = claims.sub;
  if (!sub) throw new Error('Google sub is required');

  const email = normalizeEmail(claims.email);
  if (!email) throw new Error('Google login did not provide an email');

  // Phase 1: Check for existing users
  const existing = await prisma.$transaction(async (tx) => {
    // If Google identity already linked, refresh profile + tokens
    const existingAccount = await tx.userAccount.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: sub } },
      include: { user: true },
    });
    if (existingAccount) {
      await refresh(tx, existingAccount.user.id, claims, tokens);
      return existingAccount.user;
    }

    const user = await tx.user.findUnique({ where: { email } });

    if (user) {
      // User exists and is activated — update profile and link Google account
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: claims.name ?? undefined,
          avatarUrl: claims.picture ?? undefined,
          emailVerified: claims.email_verified ? new Date() : undefined,
        },
      });

      try {
        await tx.userAccount.create({
          data: { userId: user.id, provider: 'google', providerUserId: sub },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }

      if (tokens?.access_token || tokens?.refresh_token) {
        await tx.oauthToken.upsert({
          where: { userId_provider: { userId: user.id, provider: 'google' } },
          update: {
            accessToken: tokens.access_token ?? undefined,
            refreshToken: tokens.refresh_token ?? undefined,
            expiresAt: computeExpiry(tokens.expires_in) ?? undefined,
          },
          create: {
            userId: user.id,
            provider: 'google',
            accessToken: tokens.access_token ?? '',
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: computeExpiry(tokens.expires_in) ?? new Date(Date.now() + 3600 * 1000),
          },
        });
      }

      return user;
    }

    // No existing user found
    return null;
  });

  if (existing) return { user: existing, wasCreated: false };

  // Phase 2: New user
  try {
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: claims.name ?? null,
          avatarUrl: claims.picture ?? null,
          emailVerified: claims.email_verified ? new Date() : null,
          role: 'FREE',
          subscriptionTier: 'FREE_LIGHT',
        },
      });

      await tx.userAccount.create({
        data: { userId: created.id, provider: 'google', providerUserId: sub },
      });

      if (tokens?.access_token || tokens?.refresh_token) {
        await tx.oauthToken.create({
          data: {
            userId: created.id,
            provider: 'google',
            accessToken: tokens.access_token ?? '',
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: computeExpiry(tokens.expires_in) ?? new Date(Date.now() + 3600 * 1000),
          },
        });
      }

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
      if (retries >= 2) throw err;
      return ensureUserFromGoogleInner(claims, tokens, retries + 1);
    }
    throw err;
  }
}

async function refresh(
  tx: Prisma.TransactionClient,
  userId: string,
  claims: GoogleClaims,
  tokens?: GoogleTokens
) {
  await tx.user.update({
    where: { id: userId },
    data: {
      name: claims.name ?? undefined,
      avatarUrl: claims.picture ?? undefined,
      emailVerified: claims.email_verified ? new Date() : undefined,
    },
  });
  if (tokens?.access_token || tokens?.refresh_token) {
    await tx.oauthToken.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      update: {
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt: computeExpiry(tokens.expires_in) ?? undefined,
      },
      create: {
        userId,
        provider: 'google',
        accessToken: tokens.access_token ?? '',
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: computeExpiry(tokens.expires_in) ?? new Date(Date.now() + 3600 * 1000),
      },
    });
  }
}
