import type { User } from '@prisma/client';
import { createLogger } from '../lib/logger';

const auditLogger = createLogger('auth-audit');

export type LinkProvider = 'google' | 'apple';

/**
 * Thrown when a provider sign-in matches an existing account by email but the
 * provider has not verified that address. Routes answer it with a 401 rather
 * than a 500, since it is a refusal and not a fault.
 */
export class UnverifiedProviderEmailError extends Error {
  readonly code = 'PROVIDER_EMAIL_UNVERIFIED';

  constructor(readonly provider: LinkProvider) {
    super(`${provider} sign-in matched an existing account by an unverified email`);
    this.name = 'UnverifiedProviderEmailError';
  }
}

/** Message shown to the rider when a link is refused. */
export const UNVERIFIED_PROVIDER_EMAIL_MESSAGE =
  'Verify this email address with your sign-in provider first, then try again.';

/**
 * Thrown when a provider sign-in matches a password account whose email was
 * never verified. The link waits until the rider proves they hold the
 * password (see provider-link.ts). Routes answer it with a 409 carrying a
 * short-lived link token.
 */
export class ProviderLinkNeedsPasswordError extends Error {
  readonly code = 'LINK_NEEDS_PASSWORD';

  constructor(
    readonly provider: LinkProvider,
    readonly userId: string,
    readonly email: string
  ) {
    super(`${provider} sign-in matched a password account with an unverified email`);
    this.name = 'ProviderLinkNeedsPasswordError';
  }
}

/**
 * Shown with the 409. App builds that predate the password prompt show only
 * this text, so it has to work on its own: signing in with the password, or
 * resetting it, both get the rider in.
 */
export const LINK_NEEDS_PASSWORD_MESSAGE =
  'This email already has a Loam Logger account with a password. Sign in with your password, or reset it if you have forgotten it.';

/**
 * Guard for linking a Google or Apple identity to an account found by email.
 *
 * Matching by email is only safe when the provider has verified the address,
 * so an unverified match is refused outright.
 *
 * It also guards the pre-registration takeover. Password signup did not
 * verify email, so anyone could create an account under someone else's
 * address and set its password. When the real owner later signs in through a
 * provider, linking straight away would hand them an account the squatter can
 * still log in to.
 *
 * The provider's verified email proves who owns the inbox, not who set the
 * password, and nothing else on the account can tell a squatter from a rider
 * who signed up with a password years ago. So the link is held until the
 * rider proves the password: entering it shows they made the account, and
 * resetting it through the inbox replaces a squatter's password and signs the
 * squatter out. An earlier version cleared the password, every session and
 * every share link instead, which did the same to every long-standing rider
 * who first tried Google or Apple sign-in.
 *
 * Called inside the caller's transaction, before the link is written.
 */
export function secureAccountBeforeLinking(
  user: Pick<User, 'id' | 'email' | 'passwordHash' | 'emailVerified'>,
  provider: LinkProvider,
  providerEmailVerified: boolean | undefined
): void {
  if (!providerEmailVerified) {
    auditLogger.warn(
      { userId: user.id, provider },
      'Refused to link provider: email not verified by provider'
    );
    throw new UnverifiedProviderEmailError(provider);
  }

  if (user.passwordHash && !user.emailVerified) {
    auditLogger.info(
      { userId: user.id, provider },
      'Holding provider link until the account password is confirmed'
    );
    throw new ProviderLinkNeedsPasswordError(provider, user.id, user.email);
  }
}
