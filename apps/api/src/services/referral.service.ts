import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmailWithAudit } from './email.service';
import { getReferralSuccessEmailHtml, getReferralSuccessEmailSubject, REFERRAL_SUCCESS_TEMPLATE_VERSION } from '../templates/emails/referral-success';

/**
 * Generate a unique 8-character alphanumeric referral code.
 */
export async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Fallback to longer code if collisions persist
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Look up the referrer for a given code. Returns the referrer's user ID,
 * or null if the code is invalid or is the user's own code.
 * Call this BEFORE user creation so you can include the referral in the
 * same transaction as the user insert.
 */
export async function resolveReferrer(code: string, newUserId?: string): Promise<string | null> {
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });

  if (!referrer || referrer.id === newUserId) return null;
  return referrer.id;
}

/**
 * Complete a referral after the referred user finishes onboarding.
 * Upgrades the referrer from FREE_LIGHT to FREE_FULL if applicable.
 */
export async function completeReferral(referredUserId: string): Promise<void> {
  const referral = await prisma.referral.findUnique({
    where: { referredUserId },
    include: {
      referrer: { select: { id: true, email: true, name: true, subscriptionTier: true, isFoundingRider: true } },
      referred: { select: { name: true } },
    },
  });

  if (!referral || referral.status === 'COMPLETED') return;

  // Interactive transaction: claim the referral, then conditionally upgrade.
  // Everything reads and writes fresh DB state inside the transaction boundary.
  const didUpgrade = await prisma.$transaction(async (tx) => {
    // Atomically claim — only one concurrent caller can transition PENDING → COMPLETED
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (claimed.count === 0) return false; // already completed by another call

    // Re-read referrer state inside the transaction to avoid stale data
    const referrer = await tx.user.findUniqueOrThrow({
      where: { id: referral.referrer.id },
      select: { subscriptionTier: true, isFoundingRider: true },
    });

    if (referrer.subscriptionTier === 'FREE_LIGHT' && !referrer.isFoundingRider) {
      await tx.user.update({
        where: { id: referral.referrer.id },
        data: { subscriptionTier: 'FREE_FULL' },
      });
      return true;
    }

    return false;
  });

  if (didUpgrade === false && !referral) return; // no-op from race

  if (didUpgrade) {
    logger.info({ referrerId: referral.referrer.id }, 'Referrer upgraded to FREE_FULL via referral');
  }

  logger.info({ referralId: referral.id, referredUserId }, 'Referral completed');

  // Send referral success email to the referrer (non-blocking — bypasses unsubscribe)
  if (didUpgrade) {
    try {
      const referrerFirstName = referral.referrer.name?.split(' ')[0] || undefined;
      const referredFirstName = referral.referred.name?.split(' ')[0] || undefined;

      await sendEmailWithAudit({
        to: referral.referrer.email,
        subject: getReferralSuccessEmailSubject(referredFirstName),
        html: await getReferralSuccessEmailHtml({
          name: referrerFirstName,
          referredName: referredFirstName,
        }),
        userId: referral.referrer.id,
        emailType: 'referral_success',
        triggerSource: 'user_action',
        templateVersion: REFERRAL_SUCCESS_TEMPLATE_VERSION,
        bypassUnsubscribe: true,
      });
    } catch (emailErr) {
      logger.error(
        { error: emailErr instanceof Error ? emailErr.message : String(emailErr), referrerId: referral.referrer.id },
        'Failed to send referral success email'
      );
    }
  }
}

/**
 * Get referral stats for a user.
 */
export async function getReferralStats(userId: string) {
  let user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  });

  // Backfill referral code for pre-migration users who don't have one
  if (!user.referralCode) {
    const code = await generateReferralCode();
    user = await prisma.user.update({
      where: { id: userId },
      data: { referralCode: code },
      select: { referralCode: true },
    });
  }

  const [pendingCount, completedCount] = await Promise.all([
    prisma.referral.count({ where: { referrerUserId: userId, status: 'PENDING' } }),
    prisma.referral.count({ where: { referrerUserId: userId, status: 'COMPLETED' } }),
  ]);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  return {
    referralCode: user.referralCode!,
    referralLink: `${frontendUrl}/signup?ref=${user.referralCode}`,
    pendingCount,
    completedCount,
  };
}
