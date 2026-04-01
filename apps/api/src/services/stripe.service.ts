import { stripe, STRIPE_CONFIG } from '../lib/stripe';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Get or create a Stripe customer for a user.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  logger.info({ userId, stripeCustomerId: customer.id }, 'Created Stripe customer');
  return customer.id;
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
