import Stripe from 'stripe';

const REQUIRED_STRIPE_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_ANNUAL_PRICE_ID',
] as const;

/**
 * Validate that all Stripe env vars are present and return the secret key.
 * Called at startup when STRIPE_SECRET_KEY is set — fails fast
 * rather than producing confusing errors during checkout.
 */
export function validateStripeConfig(): string {
  const missing = REQUIRED_STRIPE_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing Stripe environment variables: ${missing.join(', ')}`);
  }
  return process.env.STRIPE_SECRET_KEY as string;
}

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const secretKey = validateStripeConfig();
    _stripe = new Stripe(secretKey);
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
