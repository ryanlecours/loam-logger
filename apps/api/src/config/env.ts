/**
 * Centralized environment variable configuration.
 * Parses environment variables once at startup for type safety and consistency.
 */

export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const API_URL = process.env.API_URL || 'http://localhost:4000';

/** Rollout stage shared by the signup bot checks. */
export type SignupCheckMode = 'off' | 'monitor' | 'enforce';
export type DeviceAttestationMode = SignupCheckMode;
export type TurnstileMode = SignupCheckMode;

function parseSignupCheckMode(value: string | undefined): SignupCheckMode {
  const mode = value?.trim().toLowerCase();
  return mode === 'off' || mode === 'enforce' ? mode : 'monitor';
}

export const config = {
  /**
   * True in deployed production. Gates development-only routes out of the
   * production surface — see server.ts, where the Garmin debug and mock
   * routers are registered.
   */
  isProduction:
    process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production',

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
   * iOS bundle identifier for Apple Sign-In token audience validation.
   */
  appleBundleId: process.env.APPLE_BUNDLE_ID,

  /**
   * Device attestation on mobile password signup (App Attest on iOS, Play
   * Integrity on Android). `off` skips it, `monitor` (the default) verifies
   * and records the verdict without blocking, and `enforce` sends every
   * signup without a verified attestation through the small global
   * `signup-unattested` cap. Email verification applies either way.
   */
  deviceAttestationMode: parseSignupCheckMode(process.env.DEVICE_ATTESTATION_MODE),

  /** Apple Developer Team ID; with appleBundleId it forms the App Attest App ID. */
  appleTeamId: process.env.APPLE_TEAM_ID,

  /** Android application ID the Play Integrity verdict must name. */
  androidPackageName: process.env.ANDROID_PACKAGE_NAME || 'com.loamlabs.loamlogger',

  /**
   * Service account key (raw JSON or base64 of it) for a Google Cloud project
   * linked to the app in Play Console, used to call decodeIntegrityToken.
   */
  playIntegrityServiceAccountJson: process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON,

  /**
   * Comma-separated addresses whose signups skip attestation, for simulator,
   * emulator and locally built test installs. Exact match only (no +tag or
   * dot folding, no domains), so list only inboxes you own.
   */
  deviceAttestationBypassEmails: (process.env.DEVICE_ATTESTATION_BYPASS_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Cloudflare Turnstile on web password signup (POST /auth/signup), the web
   * counterpart of device attestation. `off` skips it, `monitor` (the
   * default) verifies and records the outcome without blocking, and `enforce`
   * sends every signup without a passing token through the small global
   * `signup-unverified-web` cap. Email verification applies either way.
   */
  turnstileMode: parseSignupCheckMode(process.env.TURNSTILE_MODE),

  /** Turnstile widget secret key, sent to Cloudflare's siteverify endpoint. */
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,

  /**
   * RevenueCat webhook authorization key for verifying inbound IAP webhooks.
   */
  revenuecatWebhookAuthKey: process.env.REVENUECAT_WEBHOOK_AUTH_KEY,
} as const;
