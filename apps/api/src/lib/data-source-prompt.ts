import { prisma } from './prisma';
import type { AuthProvider } from '@prisma/client';

/**
 * The ride providers a rider can connect. `UserAccount` also holds sign-in
 * providers (google, apple), which are not ride sources and must not count.
 */
const CONNECTABLE_PROVIDERS: readonly AuthProvider[] = ['garmin', 'strava', 'whoop', 'suunto'];

/**
 * Whether a web OAuth callback should send the rider to Settings with
 * `prompt=choose-source`, i.e. whether more than one ride provider is now
 * connected and `activeDataSource` has a real choice to make.
 *
 * One helper for all four callbacks (loam-logger#268): each used to count a
 * different subset of providers, and Suunto never prompted at all.
 *
 * Counts `UserAccount` rows rather than `UserIntegration`: every callback
 * writes a `UserAccount` row on connect and every disconnect deletes it,
 * while WHOOP never writes a `UserIntegration` row, so that table would
 * undercount by one provider.
 */
export async function shouldPromptForDataSource(userId: string): Promise<boolean> {
  const accounts = await prisma.userAccount.findMany({
    where: { userId, provider: { in: [...CONNECTABLE_PROVIDERS] } },
    select: { provider: true },
  });
  const connected = new Set(accounts.map((account) => account.provider));
  return connected.size >= 2;
}
