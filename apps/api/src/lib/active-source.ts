import type { AuthProvider } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Check if the given provider is the user's active data source.
 * Returns true if no preference is set (null) or if it matches the provider.
 */
export async function isActiveSource(userId: string, provider: AuthProvider): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeDataSource: true },
  });
  return !user?.activeDataSource || user.activeDataSource === provider;
}
