/**
 * Centralized environment variable configuration.
 * Parses environment variables once at startup for type safety and consistency.
 */

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
} as const;
