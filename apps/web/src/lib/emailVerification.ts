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

/** Confirm an address with the token from the verification email. */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) return 'verified';
    const data = await res.json().catch(() => null);
    if (data?.code === 'TOKEN_EXPIRED') return 'expired';
    if (data?.code === 'TOKEN_INVALID') return 'invalid';
    return 'error';
  } catch {
    return 'error';
  }
}
