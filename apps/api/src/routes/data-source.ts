import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendNotFound, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Get user's active data source preference
 */
r.get<Empty, void, Empty, Empty>(
  '/data-source/preference',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeDataSource: true },
      });

      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      return res.json({
        success: true,
        activeDataSource: user.activeDataSource,
      });
    } catch (error) {
      logError('Data Source fetching', error);
      return sendInternalError(res, 'Failed to fetch data source preference');
    }
  }
);

/**
 * Set user's active data source preference
 */
type DataSourceProvider = 'garmin' | 'strava' | 'whoop' | 'suunto';
const VALID_PROVIDERS: readonly DataSourceProvider[] = ['garmin', 'strava', 'whoop', 'suunto'];

r.post<Empty, void, { provider: DataSourceProvider }>(
  '/data-source/preference',
  async (req: Request<Empty, void, { provider: DataSourceProvider }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const { provider } = req.body;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return sendBadRequest(res, `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }

    try {
      // Verify user has this provider connected (check integrations, not login accounts)
      const integrationProvider = provider.toUpperCase() as 'GARMIN' | 'STRAVA' | 'WHOOP' | 'SUUNTO';
      const integration = await prisma.userIntegration.findFirst({
        where: {
          userId,
          provider: integrationProvider,
          revokedAt: null,
        },
      });

      if (!integration) {
        // Fallback: also check UserAccount for users who connected via OAuth login
        const userAccount = await prisma.userAccount.findFirst({
          where: { userId, provider },
        });

        if (!userAccount) {
          return sendBadRequest(res, `${provider.charAt(0).toUpperCase() + provider.slice(1)} account not connected`);
        }
      }

      // Update active data source
      await prisma.user.update({
        where: { id: userId },
        data: { activeDataSource: provider },
      });

      console.log(`[Data Source] User ${userId} set active source to ${provider}`);

      return res.json({
        success: true,
        activeDataSource: provider,
        message: `Active data source set to ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
      });
    } catch (error) {
      logError('Data Source setting', error);
      return sendInternalError(res, 'Failed to set data source preference');
    }
  }
);

export default r;
