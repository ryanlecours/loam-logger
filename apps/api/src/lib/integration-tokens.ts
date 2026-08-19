import type { IntegrationProvider, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { encrypt, decrypt } from './crypto';
import { createLogger } from './logger';

const log = createLogger('integration-tokens');

/**
 * Encrypted-at-rest OAuth token store, backed by `UserIntegration`.
 *
 * Provider tokens are bearer credentials for a third party's API: anyone
 * holding one can read that user's data from the provider until it expires.
 * They are stored AES-256-GCM encrypted (see ./crypto) so a database dump,
 * a snapshot, or a read-replica leak does not hand over live credentials.
 *
 * This replaces reads and writes against the legacy `OauthToken` table, which
 * stores the same values in plaintext. Garmin is fully migrated; Strava, WHOOP
 * and Suunto still read plaintext from `OauthToken` and should be moved onto
 * this module — the shape is deliberately provider-neutral so that is a small
 * change per provider rather than a rewrite.
 */

export type IntegrationTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
};

/**
 * What a read of the encrypted store found.
 *
 * `undecryptable` is split out from `disconnected` on purpose. Both mean "no
 * usable credential right now", and neither should throw through a queue worker
 * and retry forever, so the original reasoning behind collapsing them holds. But
 * they are not the same event: a rider disconnecting is routine and expected,
 * while ciphertext that will not open under the current key is an operational
 * fault, usually a rotated or misconfigured `TOKEN_ENCRYPTION_KEY`, affecting
 * every rider at once.
 *
 * Told apart, the first can be dropped quietly and the second can be raised
 * once, without retries, so a key incident surfaces instead of looking like the
 * whole userbase chose to disconnect on the same afternoon.
 */
export type IntegrationTokensResult =
  | { state: 'live'; tokens: IntegrationTokens }
  | { state: 'disconnected' }
  | { state: 'undecryptable' };

/**
 * Read and decrypt a provider's tokens.
 *
 * Never throws: a missing, revoked, or unreadable integration is reported as a
 * state so callers can decide how loud to be about it.
 */
export async function getIntegrationTokens(
  userId: string,
  provider: IntegrationProvider
): Promise<IntegrationTokensResult> {
  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider } },
    select: {
      accessTokenEnc: true,
      refreshTokenEnc: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!integration) return { state: 'disconnected' };

  // A revoked integration keeps its row for connection history, but its tokens
  // must never be handed out again. This is what makes a Garmin permission
  // revocation actually stop sync rather than merely get logged.
  if (integration.revokedAt) {
    log.debug({ userId, provider }, 'Integration is revoked; refusing to return tokens');
    return { state: 'disconnected' };
  }

  try {
    return {
      state: 'live',
      tokens: {
        accessToken: decrypt(integration.accessTokenEnc),
        refreshToken: integration.refreshTokenEnc
          ? decrypt(integration.refreshTokenEnc)
          : null,
        expiresAt: integration.expiresAt,
      },
    };
  } catch (err) {
    // Wrong/rotated key, or corrupt ciphertext. Deliberately does not log the
    // ciphertext or any token material.
    log.error(
      { err, userId, provider },
      'Failed to decrypt integration tokens'
    );
    return { state: 'undecryptable' };
  }
}

/**
 * Encrypt and persist refreshed tokens.
 *
 * `refreshToken` is only written when provided: some providers omit it on
 * refresh, and overwriting a good refresh token with null would strand the
 * connection at the next expiry.
 */
export async function saveIntegrationTokens(
  userId: string,
  provider: IntegrationProvider,
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt: Date },
  tx: Prisma.TransactionClient = prisma
): Promise<void> {
  await tx.userIntegration.update({
    where: { userId_provider: { userId, provider } },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      ...(tokens.refreshToken !== undefined && tokens.refreshToken !== null
        ? { refreshTokenEnc: encrypt(tokens.refreshToken) }
        : {}),
      expiresAt: tokens.expiresAt,
    },
  });
}

/**
 * Mark a connection revoked and destroy its stored credentials.
 *
 * Used when a provider tells us the user withdrew consent (Garmin permission
 * change or deregistration) and when the user disconnects in-app. The row
 * survives so `connectedAt`/`revokedAt` history is preserved, but the tokens
 * are overwritten rather than left decryptable — a revoked credential we can
 * still decrypt is a credential we are still storing.
 */
export async function revokeIntegration(
  userId: string,
  provider: IntegrationProvider,
  tx: Prisma.TransactionClient = prisma
): Promise<void> {
  await tx.userIntegration.updateMany({
    where: { userId, provider },
    data: {
      revokedAt: new Date(),
      accessTokenEnc: '',
      refreshTokenEnc: null,
    },
  });
}
