/**
 * WHOOP API Type Definitions
 * Based on WHOOP Developer API v2
 * https://developer.whoop.com/api/
 *
 * v2 Changes:
 * - Workout ID is now UUID string (was: number in v1)
 * - Added activity_v1_id for backwards compatibility
 * - Added sport_name field
 */

/**
 * WHOOP Workout from the Activity API v2
 * GET /developer/v2/activity/workout
 */
export type WhoopWorkout = {
  id: string;                 // v2: UUID string (was: number in v1)
  activity_v1_id?: number;    // v2: backwards compat with v1 ID
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;              // ISO 8601 datetime
  end: string;                // ISO 8601 datetime
  timezone_offset: string;
  sport_id: number;           // 1 = Cycling, 57 = Mountain Biking
  sport_name?: string;        // v2: "Cycling", "Mountain Biking", etc.
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
 * GET /developer/v2/user/profile/basic
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
 * 1 = Cycling/Bicycle
 * 57 = Mountain Biking
 */
export const WHOOP_CYCLING_SPORT_IDS = [1, 57] as const;

/**
 * Sport names that indicate cycling-related activities
 * Used for resilient filtering when sport_id may not be reliable
 */
export const WHOOP_CYCLING_SPORT_NAMES = [
  'cycling',
  'bicycle',
  'mountain biking',
  'mtb',
  'bike',
  'gravel',
] as const;

/**
 * Check if a workout is cycling-related
 * Uses sport_name first (more reliable), falls back to sport_id
 */
export function isWhoopCyclingWorkout(workout: WhoopWorkout): boolean {
  // Primary: check sport_name (case-insensitive)
  if (workout.sport_name) {
    const nameLower = workout.sport_name.toLowerCase();
    if (WHOOP_CYCLING_SPORT_NAMES.some((n) => nameLower.includes(n))) {
      return true;
    }
  }
  // Fallback: check sport_id
  return WHOOP_CYCLING_SPORT_IDS.includes(workout.sport_id as 1 | 57);
}

/**
 * Get the ride type based on workout sport
 * Returns "Mountain Bike" for MTB activities, "Cycling" otherwise
 */
export function getWhoopRideType(workout: WhoopWorkout): string {
  if (
    workout.sport_id === 57 ||
    workout.sport_name?.toLowerCase().includes('mountain')
  ) {
    return 'Mountain Bike';
  }
  return 'Cycling';
}

/**
 * WHOOP API Base URL (v2)
 */
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';

/**
 * WHOOP OAuth URLs
 */
export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
