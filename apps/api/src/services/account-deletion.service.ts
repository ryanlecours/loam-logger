import { prisma } from '../lib/prisma';
import { revokeStravaTokenForUser } from '../lib/strava-token';
import { revokeGarminTokenForUser } from '../lib/garmin-token';
import { cancelStripeBillingForAccountDeletion } from './stripe.service';

/**
 * Thrown by deleteUserAccount when Stripe billing could not be stopped.
 * Nothing has been deleted when this is thrown, so the caller should tell the
 * rider to retry (the HTTP route maps it to 503 BILLING_CANCELLATION_FAILED).
 */
export class BillingCancellationError extends Error {
  constructor(cause: unknown) {
    super('Failed to cancel Stripe billing before account deletion', { cause });
    this.name = 'BillingCancellationError';
  }
}

export interface DeletedAccount {
  email: string;
}

/**
 * Delete a user's account and all associated data.
 *
 * The single implementation of account deletion: every entry point (the
 * signed-in DELETE /auth/delete-account route and any confirm-by-email flow)
 * must call this so riders get the same teardown, Stripe cancellation
 * included. Callers own authentication and any session cleanup.
 *
 * @throws BillingCancellationError if Stripe billing could not be stopped;
 *   no data has been deleted in that case.
 */
export async function deleteUserAccount(userId: string): Promise<DeletedAccount> {
  console.log(`[DeleteAccount] Deleting account and data for user: ${userId}`);

  // 0. Stop Stripe billing BEFORE deleting anything.
  // Unlike the OAuth revocations in step 4, a failure here blocks deletion:
  // once the user row is gone the rider has no account to cancel from and we
  // lose the link to their Stripe customer, so they would keep being charged.
  // Running first means a failure leaves the account fully intact and the
  // rider can simply retry. Store-managed (App Store / Google Play)
  // subscriptions cannot be cancelled server-side and are left alone.
  try {
    await cancelStripeBillingForAccountDeletion(userId);
  } catch (stripeError) {
    throw new BillingCancellationError(stripeError);
  }

  // Delete all user data in the correct order based on foreign key relationships
  // This will cascade delete based on the Prisma schema definitions

  // 1. Delete rides (these have bikeId references)
  await prisma.ride.deleteMany({
    where: { userId },
  });
  console.log(`[DeleteAccount] Deleted rides for user: ${userId}`);

  // 2. Delete components (these reference userId with onDelete: Cascade, but do it explicitly)
  await prisma.component.deleteMany({
    where: { userId },
  });
  console.log(`[DeleteAccount] Deleted components for user: ${userId}`);

  // 3. Delete bikes
  await prisma.bike.deleteMany({
    where: { userId },
  });
  console.log(`[DeleteAccount] Deleted bikes for user: ${userId}`);

  // 4. Revoke OAuth tokens with providers BEFORE deleting locally
  // This ensures tokens are invalidated on Strava/Garmin servers
  // Note: We proceed with deletion even if revocation fails (GDPR compliance)
  console.log(`[DeleteAccount] Revoking OAuth tokens for user: ${userId}`);
  const [stravaRevoked, garminRevoked] = await Promise.all([
    revokeStravaTokenForUser(userId),
    revokeGarminTokenForUser(userId),
  ]);

  // Log warnings for failed revocations - tokens will still be deleted locally
  // but may remain valid on provider side until they expire
  if (!stravaRevoked) {
    console.warn(`[DeleteAccount] WARNING: Strava token revocation failed for user ${userId}. Token may remain valid on Strava until it expires.`);
  }
  if (!garminRevoked) {
    console.warn(`[DeleteAccount] WARNING: Garmin token revocation failed for user ${userId}. Token may remain valid on Garmin until it expires.`);
  }
  console.log(`[DeleteAccount] Token revocation complete - Strava: ${stravaRevoked}, Garmin: ${garminRevoked}`);

  // 5. Delete OAuth tokens from database.
  // UserIntegration holds the encrypted provider credentials and would be
  // removed by the cascade on step 7 anyway, but credential-bearing rows are
  // deleted explicitly here so the teardown does not depend on a schema
  // detail (same reasoning as step 6).
  await prisma.$transaction([
    prisma.oauthToken.deleteMany({ where: { userId } }),
    prisma.userIntegration.deleteMany({ where: { userId } }),
  ]);
  console.log(`[DeleteAccount] Deleted OAuth tokens for user: ${userId}`);

  // 6. Delete user accounts (these reference userId with onDelete: Cascade, but do it explicitly)
  await prisma.userAccount.deleteMany({
    where: { userId },
  });
  console.log(`[DeleteAccount] Deleted user accounts for user: ${userId}`);

  // 7. Finally, delete the user
  const deletedUser = await prisma.user.delete({
    where: { id: userId },
  });
  console.log(`[DeleteAccount] Successfully deleted user: ${deletedUser.email}`);

  return { email: deletedUser.email };
}
