import type { SubscriptionProvider, TriggerSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmailWithAudit } from './email.service';
import { getUpgradeConfirmationEmailHtml, getUpgradeConfirmationEmailSubject, UPGRADE_CONFIRMATION_TEMPLATE_VERSION } from '../templates/emails/upgrade-confirmation';
import { getDowngradeNoticeEmailHtml, getDowngradeNoticeEmailSubject, DOWNGRADE_NOTICE_TEMPLATE_VERSION } from '../templates/emails/downgrade-notice';

interface UpgradeOptions {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string;
}

/**
 * Upgrade a user to PRO. Idempotent — safe to call from multiple webhook paths.
 *
 * Sets subscriptionTier to PRO, records the subscription provider, un-archives
 * bikes, and sends a confirmation email. Skips founding riders and users already
 * on PRO via the same provider+subscription. Returns true if the upgrade was applied.
 */
export async function upgradeUser(
  userId: string,
  provider: SubscriptionProvider,
  triggerSource: TriggerSource,
  options: UpgradeOptions = {},
): Promise<boolean> {
  const upgraded = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id: userId,
        isFoundingRider: false,
        // Only upgrade if not already PRO, or if PRO via a different subscription
        OR: [
          { subscriptionTier: { not: 'PRO' } },
          ...(options.stripeSubscriptionId
            ? [{ stripeSubscriptionId: { not: options.stripeSubscriptionId } }]
            : []),
        ],
      },
      data: {
        subscriptionTier: 'PRO',
        subscriptionProvider: provider,
        stripeCustomerId: options.stripeCustomerId ?? undefined,
        stripeSubscriptionId: options.stripeSubscriptionId ?? undefined,
        needsDowngradeSelection: false,
      },
    });

    if (result.count === 0) return false;

    await tx.bike.updateMany({
      where: { userId, status: 'ARCHIVED' },
      data: { status: 'ACTIVE' },
    });

    return true;
  });

  if (!upgraded) {
    logger.info({ userId, provider }, 'Upgrade skipped (founding rider, already processed, or user not found)');
    return false;
  }

  logger.info({ userId, provider }, 'User upgraded to PRO');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  if (user) {
    try {
      const firstName = user.name?.split(' ')[0] || undefined;
      await sendEmailWithAudit({
        to: user.email,
        subject: getUpgradeConfirmationEmailSubject(),
        html: await getUpgradeConfirmationEmailHtml({ name: firstName }),
        userId,
        emailType: 'upgrade_confirmation',
        triggerSource,
        templateVersion: UPGRADE_CONFIRMATION_TEMPLATE_VERSION,
        bypassUnsubscribe: true,
      });
    } catch (emailErr) {
      logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId }, 'Failed to send upgrade confirmation email');
    }
  }

  return true;
}

/**
 * Downgrade a user from PRO. Idempotent — safe to call from both Stripe and
 * RevenueCat webhook paths.
 *
 * Determines downgrade tier based on referral status (FREE_FULL if referral,
 * FREE_LIGHT otherwise). Sets needsDowngradeSelection if user has >1 active bikes.
 * Clears provider-specific subscription fields and sends a downgrade email.
 */
export async function downgradeUser(userId: string, triggerSource: TriggerSource): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isFoundingRider: true, subscriptionTier: true, email: true, name: true },
    });

    if (!user || user.isFoundingRider || user.subscriptionTier !== 'PRO') return null;

    const [completedReferral, activeBikeCount] = await Promise.all([
      tx.referral.findFirst({ where: { referrerUserId: userId, status: 'COMPLETED' }, select: { id: true } }),
      tx.bike.count({ where: { userId, status: 'ACTIVE' } }),
    ]);

    const downgradeTier = completedReferral ? 'FREE_FULL' : 'FREE_LIGHT';
    const needsSelection = activeBikeCount > 1;

    await tx.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: downgradeTier,
        stripeSubscriptionId: null,
        subscriptionProvider: null,
        needsDowngradeSelection: needsSelection,
        // stripeCustomerId intentionally preserved — reused if the user re-subscribes via Stripe
      },
    });

    return { email: user.email, name: user.name, downgradeTier, needsSelection };
  });

  if (!result) {
    logger.info({ userId }, 'Downgrade skipped (founding rider, not PRO, or missing user)');
    return;
  }

  logger.info(
    { userId, downgradeTier: result.downgradeTier, needsDowngradeSelection: result.needsSelection },
    'User downgraded from PRO'
  );

  try {
    const firstName = result.name?.split(' ')[0] || undefined;
    await sendEmailWithAudit({
      to: result.email,
      subject: getDowngradeNoticeEmailSubject(),
      html: await getDowngradeNoticeEmailHtml({ name: firstName }),
      userId,
      emailType: 'downgrade_notice',
      triggerSource,
      templateVersion: DOWNGRADE_NOTICE_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId }, 'Failed to send downgrade notice email');
  }
}
