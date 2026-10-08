import crypto from 'crypto';
import type { TriggerSource, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendReactEmailWithAudit } from './email.service';
import {
  buildEmailVerificationEmailElement,
  getEmailVerificationEmailSubject,
  EMAIL_VERIFICATION_TEMPLATE_VERSION,
} from '../templates/emails/email-verification';
import { FRONTEND_URL } from '../config/env';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
const TOKEN_BYTES = 32;

/**
 * Shown when a gated action is refused for an unverified account. Worded for
 * every client, including app versions with no banner or resend button.
 */
export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Confirm your email address to turn on share links. Tap the link in the email we sent when you signed up.';

export type EmailVerificationUser = {
  id: string;
  email: string;
};

/**
 * True when the account must confirm its email before using gated features
 * (public share links today). Accounts created before verification shipped
 * have emailVerificationRequired = false and are never gated.
 */
export function needsEmailVerification(
  user: Pick<User, 'emailVerificationRequired' | 'emailVerified'>
): boolean {
  return user.emailVerificationRequired && !user.emailVerified;
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Store a new verification token for a user. Earlier links keep working
 * until retireOtherVerificationTokens runs, which issueEmailVerification only
 * does once the new email is out.
 * Returns the raw token. Only its hash is stored.
 */
export async function createEmailVerificationToken(
  userId: string
): Promise<{ rawToken: string; tokenId: string }> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  const { id } = await prisma.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt },
    select: { id: true },
  });
  return { rawToken, tokenId: id };
}

/** Invalidate every unused token for a user except the one just sent. */
export async function retireOtherVerificationTokens(userId: string, keepTokenId: string): Promise<void> {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null, id: { not: keepTokenId } },
    data: { usedAt: new Date() },
  });
}

/** The link in the email lands on the web app's verify-email page. */
export function buildVerifyUrl(rawToken: string): string {
  const url = new URL('/verify-email', FRONTEND_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

/**
 * Send the verification email. Bypasses the emailUnsubscribed flag, since it
 * is an account notification the rider asked for by signing up.
 */
export async function sendEmailVerificationEmail(
  user: EmailVerificationUser,
  rawToken: string,
  triggerSource: TriggerSource
): Promise<void> {
  await sendReactEmailWithAudit({
    to: user.email,
    subject: getEmailVerificationEmailSubject(),
    reactElement: buildEmailVerificationEmailElement({
      email: user.email,
      verifyUrl: buildVerifyUrl(rawToken),
      expiresInHours: EMAIL_VERIFICATION_TTL_HOURS,
    }),
    userId: user.id,
    emailType: 'email_verification',
    triggerSource,
    templateVersion: EMAIL_VERIFICATION_TEMPLATE_VERSION,
    bypassUnsubscribe: true,
  });

  logger.info({ userId: user.id }, 'Email verification email sent');
}

/**
 * Issue a token, send it, and only then retire older links, so only the
 * newest email's link works. If the send fails, the link already in the
 * rider's inbox keeps working; the unsent token just expires. Throws on
 * failure.
 */
export async function issueEmailVerification(
  user: EmailVerificationUser,
  triggerSource: TriggerSource
): Promise<void> {
  const { rawToken, tokenId } = await createEmailVerificationToken(user.id);
  await sendEmailVerificationEmail(user, rawToken, triggerSource);
  await retireOtherVerificationTokens(user.id, tokenId);
}

/**
 * Send the verification email for a freshly created account. Never throws:
 * a failed send must not fail the signup, and the rider can resend from the
 * app.
 */
export async function startEmailVerification(user: EmailVerificationUser): Promise<void> {
  try {
    await issueEmailVerification(user, 'user_action');
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to send email verification email');
  }
}

export type ConsumeVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_used' };

/**
 * Verify a raw token, mark it used and set the user's emailVerified.
 * The token is single use; the claim and the user update commit together.
 */
export async function consumeEmailVerificationToken(
  rawToken: string
): Promise<ConsumeVerificationResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!record) return { ok: false, reason: 'not_found' };
  if (record.usedAt) return settleUsedToken(record.userId);
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const claimed = await prisma.$transaction(async (tx) => {
    // Re-check unused and unexpired atomically, so a concurrent click or a
    // token expiring between the read above and this write cannot slip through.
    const { count } = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count === 0) return false;
    await tx.user.updateMany({
      where: { id: record.userId, emailVerified: null },
      data: { emailVerified: new Date() },
    });
    return true;
  });

  if (!claimed) return settleUsedToken(record.userId);
  return { ok: true, userId: record.userId };
}

/**
 * A used token is a success when the address ended up verified anyway: the
 * rider clicked the link twice, or a mail scanner opened it first, or a newer
 * link already did the job. Otherwise the link was superseded by a resend.
 */
async function settleUsedToken(userId: string): Promise<ConsumeVerificationResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  if (user?.emailVerified) return { ok: true, userId };
  return { ok: false, reason: 'already_used' };
}

/**
 * Delete verification tokens that expired more than `olderThanHours` ago.
 * Returns the number of deleted rows.
 */
export async function cleanupExpiredEmailVerificationTokens(olderThanHours = 7 * 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.emailVerificationToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
