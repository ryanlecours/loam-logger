import { createHash } from 'crypto';
import { checkAuthRateLimit, type RateLimitResult } from '../lib/rate-limit';

export const LOGIN_RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again later.';

/**
 * Key for the per-account limit. Hashed so the raw address never lands in a
 * Redis key or in the Sentry event the limiter raises when it trips.
 */
export function loginEmailKey(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 32);
}

/**
 * Rate limit a password login attempt, per IP and per account.
 *
 * The IP limit slows guessing from one source; the account limit holds when
 * the attempts are spread across many IPs, as credential stuffing does. Every
 * attempt counts, not only failures, so the check runs before the password is
 * verified and costs no bcrypt work once a caller is over the limit. The
 * account window is only charged once the IP check passes, so one noisy IP
 * cannot also burn through the account's budget.
 */
export async function checkLoginRateLimit(
  clientIp: string,
  normalizedEmail: string
): Promise<RateLimitResult> {
  const byIp = await checkAuthRateLimit('login', clientIp);
  if (!byIp.allowed) return byIp;
  return checkAuthRateLimit('login-email', loginEmailKey(normalizedEmail));
}
