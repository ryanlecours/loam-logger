/**
 * WHOOP API Type Definitions
 * Based on WHOOP Developer API v1
 * https://developer.whoop.com/api/
 */

/**
 * WHOOP Workout from the Activity API
 * GET /developer/v1/activity/workout
 */
export type WhoopWorkout = {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;              // ISO 8601 datetime
  end: string;                // ISO 8601 datetime
  timezone_offset: string;
  sport_id: number;           // 1 = Cycling/Bicycle
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: WhoopWorkoutScore;
};

export type WhoopWorkoutScore = {
  strain: number;             // 0-21 scale
  average_heart_rate: number;
  max_heart_rate: number;
  kilojoule: number;          // Energy expenditure
  percent_recorded: number;   // Data quality (0-100)
  distance_meter?: number;
  altitude_gain_meter?: number;
  altitude_change_meter?: number;
  zone_duration?: WhoopZoneDuration;
};

export type WhoopZoneDuration = {
  zone_zero_milli?: number;   // Below zone 1
  zone_one_milli?: number;    // Zone 1
  zone_two_milli?: number;    // Zone 2
  zone_three_milli?: number;  // Zone 3
  zone_four_milli?: number;   // Zone 4
  zone_five_milli?: number;   // Zone 5
};

/**
 * WHOOP User Profile
 * GET /developer/v1/user/profile/basic
 */
export type WhoopUserProfile = {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
};

/**
 * WHOOP Paginated Response wrapper
 */
export type WhoopPaginatedResponse<T> = {
  records: T[];
  next_token?: string;
};

/**
 * WHOOP OAuth Token Response
 */
export type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;         // Seconds until expiration
  token_type: 'bearer';
  scope: string;
};

/**
 * Cycling sport IDs in WHOOP
 * 1 = Cycling/Bicycle (main one)
 */
export const WHOOP_CYCLING_SPORT_IDS = [1] as const;

/**
 * WHOOP API Base URL
 */
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1';

/**
 * WHOOP OAuth URLs
 */
export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
