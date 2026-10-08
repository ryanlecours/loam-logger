import { checkAuthRateLimit, type RateLimitResult } from '../lib/rate-limit';

export const SIGNUP_RATE_LIMIT_MESSAGE = 'Too many signup attempts. Please try again later.';

/**
 * Rate limit a signup attempt from one IP, per minute and per day. The daily
 * window is only charged once the minute check passes, so a burst that the
 * minute limit already refuses does not also use up the day's budget.
 */
export async function checkSignupRateLimit(clientIp: string): Promise<RateLimitResult> {
  const perMinute = await checkAuthRateLimit('signup', clientIp);
  if (!perMinute.allowed) return perMinute;
  return checkAuthRateLimit('signup-daily', clientIp);
}
