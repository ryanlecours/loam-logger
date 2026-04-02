import { stripe, STRIPE_CONFIG } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { FRONTEND_URL } from '../config/env';

/**
 * Get or create a Stripe customer for a user.
 * Uses a PostgreSQL advisory lock keyed on user ID to prevent concurrent
 * requests from creating duplicate Stripe customers.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  // Fast path — no lock needed if already set
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (user.stripeCustomerId) return user.stripeCustomerId;

  // Serialize concurrent requests for this user via an interactive transaction
  // with a PostgreSQL advisory lock. Only one caller enters the create path.
  return prisma.$transaction(async (tx) => {
    // Acquire advisory lock scoped to this transaction (auto-released on commit/rollback).
    // hashtext returns a stable int4 for the userId string.
    await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, userId);

    // Re-check inside the lock — another request may have just finished
    const fresh = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true, stripeCustomerId: true },
    });

    if (fresh.stripeCustomerId) return fresh.stripeCustomerId;

    // We hold the lock — safe to create exactly one Stripe customer
    const customer = await stripe.customers.create({
      email: fresh.email,
      name: fresh.name ?? undefined,
      metadata: { userId },
    });

    await tx.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    logger.info({ userId, stripeCustomerId: customer.id }, 'Created Stripe customer');
    return customer.id;
  });
}

export type StripePlan = 'monthly' | 'annual';

/**
 * Create a Stripe Checkout session for upgrading to Pro.
 */
export async function createCheckoutSession(userId: string, plan: StripePlan) {
  const customerId = await getOrCreateStripeCustomer(userId);

  const priceId = plan === 'monthly' ? STRIPE_CONFIG.monthlyPriceId : STRIPE_CONFIG.annualPriceId;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: userId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${FRONTEND_URL}/settings?billing=success`,
    cancel_url: `${FRONTEND_URL}/settings?billing=cancelled`,
    subscription_data: {
      metadata: { userId },
    },
  });

  logger.info({ userId, plan, sessionId: session.id }, 'Created Stripe checkout session');
  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function createBillingPortalSession(userId: string) {
  const customerId = await getOrCreateStripeCustomer(userId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${FRONTEND_URL}/settings`,
  });

  logger.info({ userId }, 'Created Stripe billing portal session');
  return { url: session.url };
}
