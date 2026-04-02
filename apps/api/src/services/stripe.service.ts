import { stripe, STRIPE_CONFIG } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { FRONTEND_URL } from '../config/env';

/**
 * Get or create a Stripe customer for a user.
 *
 * Uses an advisory lock to prevent concurrent Stripe customer creation,
 * and keeps the Stripe API call outside the DB transaction so a transaction
 * rollback can't orphan a customer without cleanup.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  // Fast path — no lock needed if already set
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (user.stripeCustomerId) return user.stripeCustomerId;

  // Acquire advisory lock to serialize concurrent requests for this user.
  // Read fresh state inside the lock — another request may have just finished.
  const fresh = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, userId);

    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true, stripeCustomerId: true },
    });
  });

  // Another request already created the customer while we waited for the lock
  if (fresh.stripeCustomerId) return fresh.stripeCustomerId;

  // Create Stripe customer outside the transaction — if the DB write below
  // fails, we clean up the orphaned Stripe customer.
  const customer = await stripe.customers.create({
    email: fresh.email,
    name: fresh.name ?? undefined,
    metadata: { userId },
  });

  try {
    // Conditional update: only set if still null (guards against a race
    // between lock release and this write, however unlikely)
    const result = await prisma.user.updateMany({
      where: { id: userId, stripeCustomerId: null },
      data: { stripeCustomerId: customer.id },
    });

    if (result.count === 1) {
      logger.info({ userId, stripeCustomerId: customer.id }, 'Created Stripe customer');
      return customer.id;
    }

    // Another request set it — re-read the winner and clean up ours
    const winner = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    await stripe.customers.del(customer.id).catch((err) => {
      logger.warn({ userId, orphanedCustomerId: customer.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to delete orphaned Stripe customer');
    });

    return winner.stripeCustomerId!;
  } catch (err) {
    // DB write failed — clean up the Stripe customer we just created
    await stripe.customers.del(customer.id).catch((delErr) => {
      logger.warn({ userId, orphanedCustomerId: customer.id, error: delErr instanceof Error ? delErr.message : String(delErr) }, 'Failed to delete orphaned Stripe customer after DB error');
    });
    throw err;
  }
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
