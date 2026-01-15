import { Prisma } from '@prisma/client';
import { normalizeEmail, computeExpiry } from './utils';
import type { GoogleClaims, GoogleTokens } from './types';
import { prisma } from '../lib/prisma';

export async function ensureUserFromGoogle(
  claims: GoogleClaims,
  tokens?: GoogleTokens
) {
  const sub = claims.sub;
  if (!sub) throw new Error('Google sub is required');

  const email = normalizeEmail(claims.email);
  if (!email) throw new Error('Google login did not provide an email');

  return prisma.$transaction(async (tx) => {
    // If Google identity already linked, refresh profile + tokens
    const existingAccount = await tx.userAccount.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: sub } },
      include: { user: true },
    });
    if (existingAccount) {
      await refresh(tx, existingAccount.user.id, claims, tokens);
      // Block WAITLIST users from logging in via OAuth
      if (existingAccount.user.role === 'WAITLIST') {
        throw new Error('ALREADY_ON_WAITLIST');
      }
      return existingAccount.user;
    }

    // During closed beta, don't create new users via OAuth
    // Check if user exists by email
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      // New user trying to sign up via Google - redirect to closed beta page
      throw new Error('CLOSED_BETA');
    }

    // Block WAITLIST users from logging in via OAuth
    if (user.role === 'WAITLIST') {
      throw new Error('ALREADY_ON_WAITLIST');
    }

    // User exists and is activated - update profile and link Google account
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: claims.name ?? undefined,
        avatarUrl: claims.picture ?? undefined,
        emailVerified: claims.email_verified ? new Date() : undefined,
      },
    });

    // Create the external identity link if it doesn't exist
    try {
      await tx.userAccount.create({
        data: { userId: user.id, provider: 'google', providerUserId: sub },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }

    // Optional: store tokens (only if you plan to call Google APIs later)
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
  });
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
