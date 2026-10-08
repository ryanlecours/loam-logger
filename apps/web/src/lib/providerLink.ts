/** A Google sign-in held until the rider confirms the account password. */
export type PendingProviderLink = {
  linkToken: string;
  email: string;
  provider: 'google' | 'apple';
};

/**
 * Read a 409 LINK_NEEDS_PASSWORD answer from a sign-in route. Returns null
 * for any other response, so the caller keeps its usual error handling.
 */
export async function readPendingProviderLink(res: Response): Promise<PendingProviderLink | null> {
  if (res.status !== 409) return null;
  const body = await res.clone().json().catch(() => null);
  if (body?.code !== 'LINK_NEEDS_PASSWORD' || typeof body.details?.linkToken !== 'string') return null;
  return {
    linkToken: body.details.linkToken,
    email: body.details.email,
    provider: body.details.provider === 'apple' ? 'apple' : 'google',
  };
}
