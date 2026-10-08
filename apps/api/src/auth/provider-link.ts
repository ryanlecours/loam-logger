import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { sendError } from '../lib/api-response';
import { verifyPassword } from './password.utils';
import { checkLoginRateLimit, LOGIN_RATE_LIMIT_MESSAGE } from './login-rate-limit';
import {
  LINK_NEEDS_PASSWORD_MESSAGE,
  type LinkProvider,
  type ProviderLinkNeedsPasswordError,
} from './account-linking';

const auditLogger = createLogger('auth-audit');

const LINK_TOKEN_TTL = '10m';

/**
 * The provider identity a rider is trying to link, held in a signed token
 * between the 409 and their password, so the provider sign-in does not have
 * to be repeated.
 */
export type ProviderLinkClaims = {
  provider: LinkProvider;
  /** The provider's subject id for this rider. */
  sub: string;
  userId: string;
  /** The account's email when the link was offered; a changed email voids it. */
  email: string;
  name?: string | null;
  picture?: string | null;
};

/**
 * Signed with a key derived from SESSION_SECRET for this purpose alone, so a
 * link token can never verify as a session cookie or a mobile token, and
 * those can never verify as a link token.
 */
function linkSecret(): string {
  const { SESSION_SECRET } = process.env;
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return `${SESSION_SECRET}:provider-link`;
}

export function createProviderLinkToken(claims: ProviderLinkClaims): string {
  return jwt.sign(claims, linkSecret(), { expiresIn: LINK_TOKEN_TTL });
}

export function verifyProviderLinkToken(token: string): ProviderLinkClaims | null {
  try {
    const payload = jwt.verify(token, linkSecret()) as Partial<ProviderLinkClaims>;
    if (
      (payload.provider !== 'google' && payload.provider !== 'apple') ||
      typeof payload.sub !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return null;
    }
    return {
      provider: payload.provider,
      sub: payload.sub,
      userId: payload.userId,
      email: payload.email,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Answer a held link with a 409 and a link token. The client asks for the
 * account password and calls the link-provider route with both.
 */
export function sendLinkNeedsPassword(
  res: Response,
  err: ProviderLinkNeedsPasswordError,
  identity: { sub: string; name?: string | null; picture?: string | null }
): void {
  const linkToken = createProviderLinkToken({
    provider: err.provider,
    sub: identity.sub,
    userId: err.userId,
    email: err.email,
    name: identity.name ?? null,
    picture: identity.picture ?? null,
  });
  sendError(res, 409, LINK_NEEDS_PASSWORD_MESSAGE, err.code, {
    linkToken,
    email: err.email,
    provider: err.provider,
  });
}

export type LinkedUser = { id: string; email: string; name: string | null; avatarUrl: string | null };

export type CompleteLinkResult =
  | { ok: true; user: LinkedUser }
  | {
      ok: false;
      status: 400 | 401 | 409 | 429;
      code: string;
      message: string;
      retryAfter?: number;
    };

/**
 * Finish a held link: check the account password, then link the provider
 * and mark the email verified. Both are proven at that point, the inbox by
 * the provider and the account by its password.
 *
 * Rate limited exactly like password login (per IP and per account), since
 * a wrong password here is the same guess.
 */
export async function completeProviderLink(
  linkToken: string | undefined,
  password: string | undefined,
  clientIp: string
): Promise<CompleteLinkResult> {
  const expired = {
    ok: false as const,
    status: 400 as const,
    code: 'LINK_EXPIRED',
    message: 'This sign-in took too long. Please sign in with Google or Apple again.',
  };

  const claims = linkToken ? verifyProviderLinkToken(linkToken) : null;
  if (!claims) return expired;
  if (!password) {
    return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'Password is required' };
  }

  const rateLimit = await checkLoginRateLimit(clientIp, claims.email);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: LOGIN_RATE_LIMIT_MESSAGE,
      retryAfter: rateLimit.retryAfter,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, avatarUrl: true, passwordHash: true, emailVerified: true },
  });
  if (!user || user.email !== claims.email || !user.passwordHash) return expired;

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Incorrect password' };
  }

  try {
    const linked = await prisma.$transaction(async (tx) => {
      const existing = await tx.userAccount.findUnique({
        where: { provider_providerUserId: { provider: claims.provider, providerUserId: claims.sub } },
        select: { userId: true },
      });
      if (existing && existing.userId !== user.id) return null;
      if (!existing) {
        await tx.userAccount.create({
          data: { userId: user.id, provider: claims.provider, providerUserId: claims.sub },
        });
      }
      return tx.user.update({
        where: { id: user.id },
        data: {
          emailVerified: user.emailVerified ?? new Date(),
          name: user.name ?? claims.name ?? undefined,
          avatarUrl: user.avatarUrl ?? claims.picture ?? undefined,
        },
        select: { id: true, email: true, name: true, avatarUrl: true },
      });
    });

    if (!linked) {
      auditLogger.warn(
        { userId: user.id, provider: claims.provider },
        'Refused provider link: identity already linked to another account'
      );
      return {
        ok: false,
        status: 409,
        code: 'PROVIDER_ALREADY_LINKED',
        message: 'That sign-in is already connected to a different Loam Logger account.',
      };
    }

    auditLogger.info({ userId: user.id, provider: claims.provider }, 'Linked provider after password confirmation');
    return { ok: true, user: linked };
  } catch (e) {
    // Two submits of the same form race to create the link; the loser finds
    // it made by the winner, which is the outcome both wanted.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: true, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } };
    }
    throw e;
  }
}
