import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendReactEmailWithAudit } from './email.service';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { loginEmailKey } from '../auth/login-rate-limit';
import {
  buildEmailVerificationElement,
  getEmailVerificationSubject,
  EMAIL_VERIFICATION_TEMPLATE_VERSION,
} from '../templates/emails/email-verification';
import { FRONTEND_URL } from '../config/env';
import type { TriggerSource } from '@prisma/client';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;

/** Gated accounts that never verify are deleted after this many days. */
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 14;

const TOKEN_BYTES = 32;

/** API error code for a sign-in or signup that is waiting on email verification. */
export const EMAIL_VERIFICATION_REQUIRED_CODE = 'EMAIL_VERIFICATION_REQUIRED';

/**
 * Shown by every client, including mobile builds that predate verification
 * and only know to display the `error` text of a failed signup or login.
 */
export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  'Check your inbox for a link to verify your email, then sign in.';

export type EmailVerificationUser = {
  id: string;
  email: string;
  name?: string | null;
};

/**
 * True when this account may not have a session yet: a password signup made
 * after verification shipped that has not clicked its link. Accounts created
 * before then have emailVerificationRequired=false and are never gated.
 */
export function isEmailVerificationPending(user: {
  emailVerificationRequired: boolean;
  emailVerified: Date | null;
}): boolean {
  return user.emailVerificationRequired && !user.emailVerified;
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate a new verification token for a user, invalidating any unused ones
 * so only the most recent email's link works. Returns the raw token; only its
 * hash is stored.
 */
export async function createEmailVerificationToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    }),
  ]);

  return rawToken;
}

/**
 * The link lands on the web app's verify page whichever client signed up.
 * Verifying does not sign anyone in, so the page only needs to confirm and
 * send the rider back to their app or the web sign-in.
 */
export function buildVerifyUrl(rawToken: string): string {
  const url = new URL('/verify-email', FRONTEND_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

/**
 * Send the verification email. Bypasses emailUnsubscribed: an account that
 * has never verified cannot have unsubscribed from anything, and the email is
 * required to use the account.
 */
export async function sendVerificationEmail(
  user: EmailVerificationUser,
  rawToken: string,
  triggerSource: TriggerSource,
): Promise<void> {
  const firstName = user.name?.split(' ')[0];

  await sendReactEmailWithAudit({
    to: user.email,
    subject: getEmailVerificationSubject(),
    reactElement: buildEmailVerificationElement({
      recipientFirstName: firstName,
      verifyUrl: buildVerifyUrl(rawToken),
      expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
      unverifiedAccountTtlDays: UNVERIFIED_ACCOUNT_TTL_DAYS,
    }),
    userId: user.id,
    emailType: 'email_verification',
    triggerSource,
    templateVersion: EMAIL_VERIFICATION_TEMPLATE_VERSION,
    bypassUnsubscribe: true,
  });

  logger.info({ userId: user.id }, 'Email verification sent');
}

/**
 * Issue a fresh token and email it. Never throws: a failed send leaves the
 * account waiting, and the rider can ask for another link from the sign-in
 * screen, so callers should not fail the request over it.
 */
export async function issueVerificationEmail(
  user: EmailVerificationUser,
  triggerSource: TriggerSource,
): Promise<void> {
  try {
    const rawToken = await createEmailVerificationToken(user.id);
    await sendVerificationEmail(user, rawToken, triggerSource);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Email verification send failed');
  }
}

/**
 * issueVerificationEmail behind the per-account send limit
 * (`verification-email`, keyed by a hash of the address so it holds across
 * IPs). Every send goes through here, so nobody can use signup, resend or
 * sign-in attempts to flood an inbox. Returns false when the limit held the
 * send back; callers answer the same either way.
 */
export async function sendVerificationEmailWithinLimit(
  user: EmailVerificationUser,
  triggerSource: TriggerSource,
): Promise<boolean> {
  const limit = await checkAuthRateLimit('verification-email', loginEmailKey(user.email));
  if (!limit.allowed) {
    logger.info({ userId: user.id }, 'Email verification send skipped: per-account limit');
    return false;
  }
  await issueVerificationEmail(user, triggerSource);
  return true;
}

export type ConsumeVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' }
  | { ok: false; reason: 'already_used'; userId: string };

/**
 * Verify a raw token, mark it used, and mark the account's email verified.
 * A token works once; a second use reports already_used.
 */
export async function consumeEmailVerificationToken(
  rawToken: string,
): Promise<ConsumeVerificationResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!record) return { ok: false, reason: 'not_found' };
  if (record.usedAt) return { ok: false, reason: 'already_used', userId: record.userId };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const now = new Date();
  const claimed = await prisma.$transaction(async (tx) => {
    // Re-check unused and unexpired in the write itself, so a concurrent
    // consumer or a token expiring since the read above cannot slip through.
    const updated = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (updated.count === 0) return false;
    await tx.user.updateMany({
      where: { id: record.userId, emailVerified: null },
      data: { emailVerified: now },
    });
    return true;
  });

  if (!claimed) {
    const refreshed = await prisma.emailVerificationToken.findUnique({
      where: { id: record.id },
      select: { usedAt: true },
    });
    return refreshed?.usedAt
      ? { ok: false, reason: 'already_used', userId: record.userId }
      : { ok: false, reason: 'expired' };
  }

  return { ok: true, userId: record.userId };
}

/** Delete verification tokens that expired more than `olderThanHours` ago. */
export async function cleanupExpiredEmailVerificationTokens(olderThanHours = 7 * 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.emailVerificationToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
