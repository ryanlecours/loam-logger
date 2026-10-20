/** API error code for a signup or sign-in that is waiting on email verification. */
export const EMAIL_VERIFICATION_REQUIRED_CODE = 'EMAIL_VERIFICATION_REQUIRED';

/**
 * Ask the API for a fresh verification link. The API answers the same whether
 * or not the address is registered, so the only failure worth surfacing is a
 * rate limit or a network error.
 */
export async function resendVerificationEmail(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => null);
    return { ok: false, error: data?.error || 'Could not send a new link. Please try again.' };
  } catch {
    return { ok: false, error: 'A network error occurred. Please try again.' };
  }
}

export type VerifyEmailResult = 'verified' | 'expired' | 'invalid' | 'error';

/** `email` is set once verified, for prefilling the sign-in form. */
export type VerifyEmailOutcome = { status: VerifyEmailResult; email?: string };

/** Confirm an address with the token from the verification email. */
export async function verifyEmailToken(token: string): Promise<VerifyEmailOutcome> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      return { status: 'verified', email: typeof data?.email === 'string' ? data.email : undefined };
    }
    if (data?.code === 'TOKEN_EXPIRED') return { status: 'expired' };
    if (data?.code === 'TOKEN_INVALID') return { status: 'invalid' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

export type EmailSignInResult =
  /** Signed in: the session cookie is set. */
  | { status: 'signed-in'; csrfToken?: string; mustChangePassword: boolean }
  /** The email is not verified yet. Ask again later. */
  | { status: 'pending' }
  /** This browser holds no grant that can sign in. Sign in with the password. */
  | { status: 'unavailable' }
  /** Rate limited, a server error or no network. Ask again later. */
  | { status: 'retry'; retryAfterMs?: number };

/**
 * Trade this browser's sign-in grant for a session. The grant is an httpOnly
 * cookie the API set when this browser signed up (or tried to sign in before
 * verifying), so there is nothing to send: the browser attaches it.
 */
export async function completeEmailSignIn(): Promise<EmailSignInResult> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-email/complete`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (res.status === 200) {
      return {
        status: 'signed-in',
        csrfToken: typeof data?.csrfToken === 'string' ? data.csrfToken : undefined,
        mustChangePassword: data?.mustChangePassword === true,
      };
    }
    if (res.status === 202) return { status: 'pending' };
    if (res.status === 401) return { status: 'unavailable' };
    const retryAfter = data?.details?.retryAfter;
    return { status: 'retry', retryAfterMs: typeof retryAfter === 'number' ? retryAfter * 1000 : undefined };
  } catch {
    return { status: 'retry' };
  }
}

/** A grant lives as long as the verification link, so waiting longer is pointless. */
export const EMAIL_SIGN_IN_POLL_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait before asking again, `elapsedMs` into the wait: every 3s
 * for the first two minutes (the rider is likely opening the email right
 * now), every 10s to ten minutes, then every 30s. Null once the grant has
 * expired.
 */
export function emailSignInPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= EMAIL_SIGN_IN_POLL_LIMIT_MS) return null;
  if (elapsedMs < 2 * 60 * 1000) return 3_000;
  if (elapsedMs < 10 * 60 * 1000) return 10_000;
  return 30_000;
}
