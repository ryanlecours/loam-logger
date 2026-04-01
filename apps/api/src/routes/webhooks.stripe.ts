import { Router, type Request, type Response } from 'express';
import { stripe, STRIPE_CONFIG } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmailWithAudit } from '../services/email.service';
import { getUpgradeConfirmationEmailHtml, getUpgradeConfirmationEmailSubject, UPGRADE_CONFIRMATION_TEMPLATE_VERSION } from '../templates/emails/upgrade-confirmation';
import { getDowngradeNoticeEmailHtml, getDowngradeNoticeEmailSubject, DOWNGRADE_NOTICE_TEMPLATE_VERSION } from '../templates/emails/downgrade-notice';
import { getPaymentFailedEmailHtml, getPaymentFailedEmailSubject, PAYMENT_FAILED_TEMPLATE_VERSION } from '../templates/emails/payment-failed';
import type Stripe from 'stripe';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_CONFIG.webhookSecret);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Stripe webhook signature verification failed');
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  logger.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type');
    }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), eventType: event.type }, 'Error processing Stripe webhook');
    // Return 200 to prevent Stripe from retrying — we've logged the error
    res.status(200).json({ received: true, error: true });
    return;
  }

  res.status(200).json({ received: true });
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id;
  if (!userId) {
    logger.error({ sessionId: session.id }, 'Checkout session missing client_reference_id');
    return;
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  // Idempotency: check if already processed
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, stripeSubscriptionId: true, isFoundingRider: true, email: true, name: true },
  });

  if (!user) {
    logger.error({ userId }, 'User not found for checkout completion');
    return;
  }

  // Don't downgrade founding riders
  if (user.isFoundingRider) {
    logger.info({ userId }, 'Skipping checkout for founding rider');
    return;
  }

  // Already has this subscription
  if (user.stripeSubscriptionId === subscriptionId) {
    logger.info({ userId, subscriptionId }, 'Checkout already processed (idempotent)');
    return;
  }

  await prisma.$transaction([
    // Upgrade user to PRO
    prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: 'PRO',
        stripeCustomerId: customerId ?? undefined,
        stripeSubscriptionId: subscriptionId ?? undefined,
        needsDowngradeSelection: false,
      },
    }),
    // Restore any archived bikes
    prisma.bike.updateMany({
      where: { userId, status: 'ARCHIVED' },
      data: { status: 'ACTIVE' },
    }),
  ]);

  logger.info({ userId, subscriptionId }, 'User upgraded to PRO via Stripe checkout');

  // Send upgrade confirmation email (non-blocking, transactional — bypasses unsubscribe)
  try {
    const firstName = user.name?.split(' ')[0] || undefined;

    await sendEmailWithAudit({
      to: user.email,
      subject: getUpgradeConfirmationEmailSubject(),
      html: await getUpgradeConfirmationEmailHtml({ name: firstName }),
      userId,
      emailType: 'upgrade_confirmation',
      triggerSource: 'user_action',
      templateVersion: UPGRADE_CONFIRMATION_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId }, 'Failed to send upgrade confirmation email');
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, 'Subscription update missing userId metadata');
    return;
  }

  // Log the update for now — plan changes (monthly↔annual) don't change the tier
  logger.info(
    { userId, subscriptionId: subscription.id, status: subscription.status },
    'Subscription updated'
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, 'Subscription deletion missing userId metadata');
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isFoundingRider: true, subscriptionTier: true, email: true, name: true },
  });

  if (!user || user.isFoundingRider) {
    logger.info({ userId }, 'Skipping subscription deletion for founding rider or missing user');
    return;
  }

  // Check if user has a completed referral to determine downgrade target
  const completedReferral = await prisma.referral.findFirst({
    where: { referrerUserId: userId, status: 'COMPLETED' },
  });

  const downgradeTier = completedReferral ? 'FREE_FULL' : 'FREE_LIGHT';

  // Count active bikes to determine if downgrade selection is needed
  const activeBikeCount = await prisma.bike.count({
    where: { userId, status: 'ACTIVE' },
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionTier: downgradeTier,
      stripeSubscriptionId: null,
      needsDowngradeSelection: activeBikeCount > 1,
    },
  });

  logger.info(
    { userId, downgradeTier, needsDowngradeSelection: activeBikeCount > 1 },
    'User downgraded from PRO'
  );

  // Send downgrade notice email (non-blocking, transactional — bypasses unsubscribe)
  try {
    const firstName = user.name?.split(' ')[0] || undefined;

    await sendEmailWithAudit({
      to: user.email,
      subject: getDowngradeNoticeEmailSubject(),
      html: await getDowngradeNoticeEmailHtml({ name: firstName }),
      userId,
      emailType: 'downgrade_notice',
      triggerSource: 'user_action',
      templateVersion: DOWNGRADE_NOTICE_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId }, 'Failed to send downgrade notice email');
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    logger.warn({ customerId }, 'Payment failed for unknown customer');
    return;
  }

  logger.warn({ userId: user.id, invoiceId: invoice.id }, 'Payment failed');

  // Send payment failed email (non-blocking, transactional — bypasses unsubscribe)
  try {
    const firstName = user.name?.split(' ')[0] || undefined;

    await sendEmailWithAudit({
      to: user.email,
      subject: getPaymentFailedEmailSubject(),
      html: await getPaymentFailedEmailHtml({ name: firstName }),
      userId: user.id,
      emailType: 'payment_failed',
      triggerSource: 'user_action',
      templateVersion: PAYMENT_FAILED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId: user.id }, 'Failed to send payment failed email');
  }
}

export default router;
