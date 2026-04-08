import { Router, type Request, type Response } from 'express';
import { stripe, STRIPE_CONFIG } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmailWithAudit } from '../services/email.service';
import { upgradeUser, downgradeUser } from '../services/subscription.service';
import { getPaymentFailedEmailHtml, getPaymentFailedEmailSubject, PAYMENT_FAILED_TEMPLATE_VERSION } from '../templates/emails/payment-failed';
import type Stripe from 'stripe';

/**
 * Resolve a userId from a Stripe object. Tries metadata first, then falls back
 * to looking up the user by stripeCustomerId. This handles subscriptions
 * modified via the Stripe dashboard where metadata may not be set.
 */
async function resolveUserId(metadata: Stripe.Metadata | undefined | null, customerId: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  if (metadata?.userId) return metadata.userId;

  const cid = typeof customerId === 'string' ? customerId : customerId?.id;
  if (!cid) return null;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: cid },
    select: { id: true },
  });

  return user?.id ?? null;
}

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
    // Return 500 so Stripe retries (up to 3 days). Our handlers are idempotent,
    // so retries are safe. Swallowing transient DB failures with 200 would
    // silently drop upgrades/downgrades.
    res.status(500).json({ received: true, error: true });
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

  if (!subscriptionId) {
    logger.error({ sessionId: session.id, userId }, 'Checkout session missing subscription ID');
    return;
  }

  await upgradeUser(userId, 'STRIPE', 'stripe_webhook', {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = await resolveUserId(subscription.metadata, subscription.customer);
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, 'Subscription update: could not resolve userId');
    return;
  }

  // Quick check to skip founding riders without a transaction
  const userCheck = await prisma.user.findUnique({
    where: { id: userId },
    select: { isFoundingRider: true },
  });

  if (!userCheck || userCheck.isFoundingRider) return;

  logger.info(
    { userId, subscriptionId: subscription.id, status: subscription.status },
    'Subscription updated'
  );

  if (subscription.status === 'active') {
    await upgradeUser(userId, 'STRIPE', 'stripe_webhook', {
      stripeSubscriptionId: subscription.id,
    });
  } else if (subscription.status === 'canceled') {
    // Stripe can fire updated with 'canceled' before or instead of the deleted event.
    // Trigger the same downgrade logic — it's idempotent.
    await downgradeUser(userId, 'stripe_webhook');
  } else if (subscription.status === 'past_due') {
    logger.warn({ userId, subscriptionId: subscription.id }, 'Subscription is past due');
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = await resolveUserId(subscription.metadata, subscription.customer);
  if (!userId) {
    logger.warn({ subscriptionId: subscription.id }, 'Subscription deletion: could not resolve userId');
    return;
  }

  await downgradeUser(userId, 'stripe_webhook');
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    logger.warn({ customerId }, 'Payment failed for unknown customer');
    return;
  }

  logger.warn({ userId: user.id, invoiceId: invoice.id }, 'Payment failed');

  // Dedup: Stripe retries failed payment webhooks for up to 72 hours.
  // Only send one payment_failed email per 24-hour window per user.
  const recentEmail = await prisma.emailSend.findFirst({
    where: {
      userId: user.id,
      emailType: 'payment_failed',
      status: 'sent',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });

  if (recentEmail) {
    logger.info({ userId: user.id, invoiceId: invoice.id }, 'Payment failed email already sent in last 24h, skipping');
    return;
  }

  try {
    const firstName = user.name?.split(' ')[0] || undefined;

    await sendEmailWithAudit({
      to: user.email,
      subject: getPaymentFailedEmailSubject(),
      html: await getPaymentFailedEmailHtml({ name: firstName }),
      userId: user.id,
      emailType: 'payment_failed',
      triggerSource: 'stripe_webhook',
      templateVersion: PAYMENT_FAILED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId: user.id }, 'Failed to send payment failed email');
  }
}

export default router;
