/**
 * Centralized environment variable configuration.
 * Parses environment variables once at startup for type safety and consistency.
 */

export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const config = {
  /**
   * When true, blocks manual sync operations to prevent "unprompted pull"
   * violations during Garmin Partner Verification testing.
   */
  garminVerificationMode: process.env.GARMIN_VERIFICATION_MODE === 'true',

  /**
   * Base URL for Garmin Wellness API.
   */
  garminApiBase: process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api',

  /**
   * Optional Expo push notification access token.
   * Without it the SDK uses anonymous access (lower rate limits).
   */
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,

  /**
   * Stripe configuration for subscription billing.
   */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripeMonthlyPriceId: process.env.STRIPE_MONTHLY_PRICE_ID,
  stripeAnnualPriceId: process.env.STRIPE_ANNUAL_PRICE_ID,

  /**
   * When true, new signups skip the waitlist and are created as FREE users
   * who can log in immediately. Set to false (default) to re-enable the waitlist gate.
   */
  bypassWaitlistFlow: process.env.BYPASS_WAITLIST_FLOW === 'true',

  /**
   * iOS bundle identifier for Apple Sign-In token audience validation.
   */
  appleBundleId: process.env.APPLE_BUNDLE_ID,

  /**
   * RevenueCat webhook authorization key for verifying inbound IAP webhooks.
   */
  revenuecatWebhookAuthKey: process.env.REVENUECAT_WEBHOOK_AUTH_KEY,
} as const;
