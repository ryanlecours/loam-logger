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
 * Apply a referral code during signup. Creates a PENDING referral record.
 * Returns false if the code is invalid.
 */
export async function applyReferralCode(newUserId: string, code: string): Promise<boolean> {
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });

  if (!referrer || referrer.id === newUserId) return false;

  // Check if this user was already referred
  const existing = await prisma.referral.findUnique({
    where: { referredUserId: newUserId },
  });
  if (existing) return false;

  await prisma.referral.create({
    data: {
      referrerUserId: referrer.id,
      referredUserId: newUserId,
    },
  });

  logger.info({ referrerId: referrer.id, referredUserId: newUserId }, 'Referral code applied');
  return true;
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

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Upgrade referrer if they're on FREE_LIGHT
  const didUpgrade = referral.referrer.subscriptionTier === 'FREE_LIGHT' && !referral.referrer.isFoundingRider;
  if (didUpgrade) {
    await prisma.user.update({
      where: { id: referral.referrer.id },
      data: { subscriptionTier: 'FREE_FULL' },
    });
    logger.info({ referrerId: referral.referrer.id }, 'Referrer upgraded to FREE_FULL via referral');
  }

  logger.info({ referralId: referral.id, referredUserId }, 'Referral completed');

  // Send referral success email to the referrer (non-blocking, transactional — bypasses unsubscribe)
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
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  });

  const [pendingCount, completedCount] = await Promise.all([
    prisma.referral.count({ where: { referrerUserId: userId, status: 'PENDING' } }),
    prisma.referral.count({ where: { referrerUserId: userId, status: 'COMPLETED' } }),
  ]);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  return {
    referralCode: user.referralCode ?? '',
    referralLink: user.referralCode ? `${frontendUrl}/beta-waitlist?ref=${user.referralCode}` : '',
    pendingCount,
    completedCount,
  };
}
