import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendReactEmailWithAudit } from './email.service';
import {
  buildPasswordResetEmailElement,
  getPasswordResetEmailSubject,
  PASSWORD_RESET_TEMPLATE_VERSION,
} from '../templates/emails/password-reset';
import { FRONTEND_URL } from '../config/env';
import type { TriggerSource } from '@prisma/client';

export const PASSWORD_RESET_TTL_MINUTES = 60;
const TOKEN_BYTES = 32;

export type PasswordResetUser = {
  id: string;
  email: string;
  name?: string | null;
};

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate a new password reset token for a user.
 * Invalidates any existing unused tokens for the same user.
 * Returns the raw token — store only the hash, never persist the raw token.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    }),
  ]);

  return rawToken;
}

/**
 * Build the reset URL that lands on the web app's reset-password page.
 * The web page handles redirecting to the mobile deep link for app users
 * (iOS/Android universal link interception also handled via expo scheme).
 */
export function buildResetUrl(rawToken: string): string {
  const url = new URL('/reset-password', FRONTEND_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

/**
 * Send a password reset email to a user.
 * Bypasses the emailUnsubscribed flag (security notification).
 */
export async function sendPasswordResetEmail(
  user: PasswordResetUser,
  rawToken: string,
  triggerSource: TriggerSource,
): Promise<void> {
  const firstName = user.name?.split(' ')[0];
  const resetUrl = buildResetUrl(rawToken);

  await sendReactEmailWithAudit({
    to: user.email,
    subject: getPasswordResetEmailSubject(),
    reactElement: buildPasswordResetEmailElement({
      recipientFirstName: firstName,
      email: user.email,
      resetUrl,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
    }),
    userId: user.id,
    emailType: 'password_reset',
    triggerSource,
    templateVersion: PASSWORD_RESET_TEMPLATE_VERSION,
    bypassUnsubscribe: true,
  });

  logger.info({ userId: user.id }, 'Password reset email sent');
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' }
  | { ok: false; reason: 'already_used'; userId: string }
  // Atomic update lost the race (count=0 after passing the initial checks).
  // The cause is either a concurrent consumer or sub-ms expiry — a follow-up
  // read disambiguates. Surfaced separately so the caller doesn't log the
  // benign expiry case as a security event.
  | { ok: false; reason: 'race_expired'; userId: string };

/**
 * Verify a raw token and mark it used. Returns the associated userId on success.
 * Safe against token reuse — the same token cannot be consumed twice.
 *
 * `already_used` results include the userId so callers can log which user's
 * reset link may have leaked, without exposing that distinction to the client.
 */
export async function consumePasswordResetToken(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record) {
    return { ok: false, reason: 'not_found' };
  }
  if (record.usedAt) {
    return { ok: false, reason: 'already_used', userId: record.userId };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const updated = await prisma.passwordResetToken.updateMany({
    // Re-check both unused and not-yet-expired atomically so a token expiring
    // between the findUnique above and this write can't slip through.
    where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (updated.count === 0) {
    // Atomic update lost the race. Re-read to tell "concurrent consumer
    // (security signal)" apart from "just expired between our read and
    // write (benign, no alert)".
    const refreshed = await prisma.passwordResetToken.findUnique({
      where: { id: record.id },
      select: { usedAt: true, expiresAt: true },
    });
    if (refreshed?.usedAt) {
      return { ok: false, reason: 'already_used', userId: record.userId };
    }
    // Either the row vanished (unlikely) or it's past expiry now — treat as
    // a benign expiry race. No security alert warranted.
    return { ok: false, reason: 'race_expired', userId: record.userId };
  }

  return { ok: true, userId: record.userId };
}

/**
 * Delete password reset tokens whose `expiresAt` was more than `olderThanHours`
 * hours ago. Invalidated-but-never-used and expired tokens accumulate
 * indefinitely otherwise; a scheduled job calls this to keep the table bounded.
 * Returns the number of deleted rows.
 */
export async function cleanupExpiredPasswordResetTokens(olderThanHours = 7 * 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
