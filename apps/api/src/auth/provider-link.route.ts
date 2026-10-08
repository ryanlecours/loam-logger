import express from 'express';
import type { Response } from 'express';
import { getClientIp } from './utils';
import { issueMobileTokens, issueWebSession } from './session-issuer';
import { setCsrfCookie } from './csrf';
import { updateLastAuthAt } from './recent-auth';
import { completeProviderLink, type CompleteLinkResult } from './provider-link';
import { sendError, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { logger } from '../lib/logger';

const router = express.Router();

type Failure = Extract<CompleteLinkResult, { ok: false }>;

function sendFailure(res: Response, result: Failure): void {
  if (result.status === 429) {
    sendTooManyRequests(res, result.message, result.retryAfter);
    return;
  }
  sendError(res, result.status, result.message, result.code);
}

/**
 * POST /auth/link-provider
 * Web: finish a Google sign-in that matched a password account, by proving
 * the password. Starts a web session on success, like /auth/login.
 */
router.post('/link-provider', express.json(), async (req, res) => {
  try {
    const { linkToken, password } = req.body as { linkToken?: string; password?: string };
    const result = await completeProviderLink(linkToken, password, getClientIp(req));
    if (!result.ok) return sendFailure(res, result);

    updateLastAuthAt(result.user.id).catch((err) =>
      logger.error({ err, userId: result.user.id }, '[ProviderLink] Failed to update lastAuthAt')
    );
    await issueWebSession(res, result.user);
    const csrfToken = setCsrfCookie(res);
    return res.status(200).json({ ok: true, csrfToken });
  } catch (e) {
    logger.error({ err: e }, '[ProviderLink] Web link failed');
    return sendInternalError(res, 'Could not connect your account');
  }
});

/**
 * POST /auth/mobile/link-provider
 * Mobile: the same, returning a token pair and the user like the other
 * mobile sign-in routes.
 */
router.post('/mobile/link-provider', express.json(), async (req, res) => {
  try {
    const { linkToken, password } = req.body as { linkToken?: string; password?: string };
    const result = await completeProviderLink(linkToken, password, getClientIp(req));
    if (!result.ok) return sendFailure(res, result);

    updateLastAuthAt(result.user.id).catch((err) =>
      logger.error({ err, userId: result.user.id }, '[ProviderLink] Failed to update lastAuthAt')
    );
    const { accessToken, refreshToken } = await issueMobileTokens(result.user);
    return res.status(200).json({ accessToken, refreshToken, user: result.user });
  } catch (e) {
    logger.error({ err: e }, '[ProviderLink] Mobile link failed');
    return sendInternalError(res, 'Could not connect your account');
  }
});

export default router;
