import type { Prisma, User } from '@prisma/client';
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
 * Guard for linking a Google or Apple identity to an account found by email.
 *
 * Matching by email is only safe when the provider has verified the address,
 * so an unverified match is refused outright.
 *
 * It also closes the pre-registration takeover. Password signup does not
 * verify email, so anyone can create an account under someone else's address
 * and set its password. When the real owner later signs in through a
 * provider, linking would hand them an account the squatter can still log in
 * to. A provider-verified sign-in is the first proof of ownership that
 * account has seen, so an unverified password is cleared, every existing
 * session is revoked by bumping sessionTokenVersion (the same mechanism a
 * password reset uses), and public share links are revoked. The owner keeps
 * provider sign-in, and can set a password again through forgot-password,
 * which proves the address.
 *
 * Runs inside the caller's transaction, before the link is written.
 */
export async function secureAccountBeforeLinking(
  tx: Prisma.TransactionClient,
  user: Pick<User, 'id' | 'passwordHash' | 'emailVerified'>,
  provider: LinkProvider,
  providerEmailVerified: boolean | undefined
): Promise<void> {
  if (!providerEmailVerified) {
    auditLogger.warn(
      { userId: user.id, provider },
      'Refused to link provider: email not verified by provider'
    );
    throw new UnverifiedProviderEmailError(provider);
  }

  if (user.passwordHash && !user.emailVerified) {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: null, sessionTokenVersion: { increment: 1 } },
    });
    // Public share links outlive sessions: a squatter who made one could keep
    // reading the account's bike and component history through it after
    // losing access. Revoked the same way disableBikeShare and
    // revokeComponentShare do. Integrations are left alone; they are not an
    // access path, and disconnecting a genuine rider's Strava or Garmin here
    // would cost far more than a broken share link.
    const bikeShares = await tx.bike.updateMany({
      where: { userId: user.id, shareSlug: { not: null } },
      data: { shareSlug: null },
    });
    const componentShares = await tx.componentShare.deleteMany({ where: { userId: user.id } });
    auditLogger.warn(
      {
        userId: user.id,
        provider,
        revokedBikeShares: bikeShares.count,
        revokedComponentShares: componentShares.count,
      },
      'Cleared unverified password, revoked sessions and share links before linking provider'
    );
  }
}
