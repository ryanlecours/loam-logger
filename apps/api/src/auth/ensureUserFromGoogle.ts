import { Prisma } from '@prisma/client';
import { normalizeEmail, computeExpiry } from './utils';
import type { GoogleClaims, GoogleTokens } from './types';
import { prisma } from '../lib/prisma';
import { config } from '../config/env';
import { resolveReferrer, createUserWithReferralCode } from '../services/referral.service';

export async function ensureUserFromGoogle(
  claims: GoogleClaims,
  tokens?: GoogleTokens,
  ref?: string,
) {
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
      if (existingAccount.user.role === 'WAITLIST') {
        throw new Error('ALREADY_ON_WAITLIST');
      }
      return existingAccount.user;
    }

    const user = await tx.user.findUnique({ where: { email } });

    if (user?.role === 'WAITLIST') {
      throw new Error('ALREADY_ON_WAITLIST');
    }

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

  if (existing) return existing;

  // Phase 2: New user — create with referral code retry handling
  if (!config.bypassWaitlistFlow) {
    throw new Error('CLOSED_BETA');
  }

  const referrerId = ref ? await resolveReferrer(ref) : null;

  return createUserWithReferralCode(async (referralCode) => {
    return prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          name: claims.name ?? null,
          avatarUrl: claims.picture ?? null,
          emailVerified: claims.email_verified ? new Date() : null,
          role: 'FREE',
          subscriptionTier: 'FREE_LIGHT',
          referralCode,
        },
      });

      await tx.userAccount.create({
        data: { userId: newUser.id, provider: 'google', providerUserId: sub },
      });

      if (referrerId) {
        await tx.referral.create({
          data: { referrerUserId: referrerId, referredUserId: newUser.id },
        });
      }

      if (tokens?.access_token || tokens?.refresh_token) {
        await tx.oauthToken.create({
          data: {
            userId: newUser.id,
            provider: 'google',
            accessToken: tokens.access_token ?? '',
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: computeExpiry(tokens.expires_in) ?? new Date(Date.now() + 3600 * 1000),
          },
        });
      }

      return newUser;
    });
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
