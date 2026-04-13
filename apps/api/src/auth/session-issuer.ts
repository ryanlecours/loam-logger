import type { Response } from 'express';
import { prisma } from '../lib/prisma';
import { setSessionCookie } from './session';
import { generateAccessToken, generateRefreshToken } from './token';

/**
 * Fetch the user's current sessionTokenVersion. Used to stamp tokens at issue time
 * so we can reject tokens issued before a password reset or other revocation event.
 */
async function getSessionTokenVersion(userId: string): Promise<number> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionTokenVersion: true },
  });
  return row?.sessionTokenVersion ?? 0;
}

/**
 * Issue a web session cookie for the given user, stamped with their current
 * sessionTokenVersion so the session can be revoked by bumping the version.
 */
export async function issueWebSession(
  res: Response,
  user: { id: string; email: string },
): Promise<void> {
  const v = await getSessionTokenVersion(user.id);
  setSessionCookie(res, { uid: user.id, email: user.email, authAt: Date.now(), v });
}

export type MobileTokenPair = {
  accessToken: string;
  refreshToken: string;
};

/**
 * Issue a mobile access + refresh token pair stamped with the user's current
 * sessionTokenVersion.
 */
export async function issueMobileTokens(user: {
  id: string;
  email: string;
}): Promise<MobileTokenPair> {
  const v = await getSessionTokenVersion(user.id);
  return {
    accessToken: generateAccessToken({ uid: user.id, email: user.email, v }),
    refreshToken: generateRefreshToken({ uid: user.id, email: user.email, v }),
  };
}
