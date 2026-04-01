import Stripe from 'stripe';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/** Lazy-initialized Stripe client. Defers initialization until first use. */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const instance = getStripe();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});

export const STRIPE_CONFIG = {
  get monthlyPriceId() { return process.env.STRIPE_MONTHLY_PRICE_ID!; },
  get annualPriceId() { return process.env.STRIPE_ANNUAL_PRICE_ID!; },
  get webhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET!; },
} as const;
